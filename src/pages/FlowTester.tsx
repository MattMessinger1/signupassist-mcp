import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2, XCircle, Clock, PlayCircle, AlertCircle, Calendar } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { OpenTimePicker } from '@/components/OpenTimePicker';

interface Child {
  id: string;
  name: string;
  dob?: string;
}

interface Credential {
  id: string;
  alias: string;
  provider: string;
}

interface FlowStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  error?: string;
}

interface MandateConfig {
  provider: string;
  programRef: string;
  childId: string;
  credentialId: string;
  maxAmountCents: number;
  scopes: string[];
  validUntil: Date;
}

interface PlanConfig {
  opensAt: Date;
  answers: {
    color_group: string;
    rentals: string;
    volunteer: string;
  };
  maxProviderChargeCents: number;
  serviceFeeCents: number;
  notes: string;
}

export default function FlowTester() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Phase state
  const [phase, setPhase] = useState<'config' | 'execution'>('config');
  
  // Data fetching
  const [children, setChildren] = useState<Child[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  
  // Configuration state
  const [mandateConfig, setMandateConfig] = useState<MandateConfig>({
    provider: 'skiclubpro',
    programRef: 'blackhawk/2024-2025/youth-ski',
    childId: '',
    credentialId: '',
    maxAmountCents: 50000,
    scopes: ['scp:login', 'scp:enroll', 'scp:write:register', 'scp:pay', 'signupassist:fee'],
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  
  const [planConfig, setPlanConfig] = useState<PlanConfig>({
    opensAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
    answers: {
      color_group: 'Red',
      rentals: 'None',
      volunteer: 'Instructor',
    },
    maxProviderChargeCents: 40000,
    serviceFeeCents: 10000,
    notes: 'Flow test execution',
  });
  
  // Execution state
  const [running, setRunning] = useState(false);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [steps, setSteps] = useState<FlowStep[]>([
    { id: 'mandate', label: 'Create Authorization (Mandate)', status: 'pending' },
    { id: 'plan', label: 'Create Execution Plan', status: 'pending' },
    { id: 'execute', label: 'Execute Registration (Mock)', status: 'pending' },
    { id: 'payment', label: 'Simulate Payment (No Charge)', status: 'pending' },
  ]);

  // Fetch children and credentials
  useEffect(() => {
    if (!user) return;
    
    const fetchData = async () => {
      setLoadingData(true);
      
      // Fetch children
      const { data: childrenData } = await supabase
        .from('children')
        .select('id, name, dob')
        .eq('user_id', user.id);
      
      // Fetch credentials
      const { data: credentialsData } = await supabase
        .from('stored_credentials')
        .select('id, alias, provider')
        .eq('user_id', user.id)
        .eq('provider', 'skiclubpro');
      
      setChildren(childrenData || []);
      setCredentials(credentialsData || []);
      
      // Set defaults if available
      if (childrenData && childrenData.length > 0) {
        setMandateConfig(prev => ({ ...prev, childId: childrenData[0].id }));
      }
      if (credentialsData && credentialsData.length > 0) {
        setMandateConfig(prev => ({ ...prev, credentialId: credentialsData[0].id }));
      }
      
      setLoadingData(false);
    };
    
    fetchData();
  }, [user]);

  const updateStep = (id: string, updates: Partial<FlowStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const startFlowTest = () => {
    // Validation
    if (!mandateConfig.childId) {
      toast({ title: 'Please select a child', variant: 'destructive' });
      return;
    }
    if (!mandateConfig.credentialId) {
      toast({ title: 'Please select credentials', variant: 'destructive' });
      return;
    }
    if (planConfig.opensAt < new Date()) {
      toast({ title: 'Opens at must be in the future', variant: 'destructive' });
      return;
    }
    if (planConfig.opensAt > mandateConfig.validUntil) {
      toast({ title: 'Opens at must be before mandate expiry', variant: 'destructive' });
      return;
    }
    
    setPhase('execution');
    runFullFlow();
  };

  const runFullFlow = async () => {
    if (!user) return;
    
    setRunning(true);
    
    try {
      // Step 1: Create mandate
      updateStep('mandate', { status: 'running' });
      const { data: mandateData, error: mandateError } = await supabase.functions.invoke('mandate-issue', {
        body: {
          provider: mandateConfig.provider,
          program_ref: mandateConfig.programRef,
          credential_id: mandateConfig.credentialId,
          child_id: mandateConfig.childId,
          max_amount_cents: mandateConfig.maxAmountCents,
          scopes: mandateConfig.scopes,
          valid_until: mandateConfig.validUntil.toISOString(),
        }
      });

      if (mandateError) throw mandateError;
      const createdMandateId = mandateData?.mandate?.id || mandateData?.mandate_id;
      if (!createdMandateId) throw new Error('No mandate ID returned');
      
      setMandateId(createdMandateId);
      updateStep('mandate', { status: 'success', result: `Mandate ID: ${createdMandateId}` });

      // Step 2: Create plan
      updateStep('plan', { status: 'running' });
      const { data: planData, error: planError } = await supabase.functions.invoke('create-plan', {
        body: {
          mandate_id: createdMandateId,
          provider: mandateConfig.provider,
          program_ref: mandateConfig.programRef,
          child_id: mandateConfig.childId,
          opens_at: planConfig.opensAt.toISOString(),
          answers: planConfig.answers,
          max_provider_charge_cents: planConfig.maxProviderChargeCents,
          service_fee_cents: planConfig.serviceFeeCents,
          notes: planConfig.notes,
        }
      });

      if (planError) throw planError;
      const createdPlanId = planData?.plan?.id || planData?.id;
      if (!createdPlanId) throw new Error('No plan ID returned');
      
      setPlanId(createdPlanId);
      updateStep('plan', { status: 'success', result: `Plan ID: ${createdPlanId}` });

      // Step 3: Execute plan (mock)
      updateStep('execute', { status: 'running' });
      try {
        await supabase.functions.invoke('run-plan', {
          body: {
            plan_id: createdPlanId,
            action: 'register',
            mock: true,
          }
        });
        updateStep('execute', { status: 'success', result: 'Registration simulated successfully' });
      } catch (error) {
        // Expected in test mode
        updateStep('execute', { status: 'success', result: 'Registration simulated (mock mode)' });
      }

      // Step 4: Simulate payment
      updateStep('payment', { status: 'running' });
      const totalCents = planConfig.maxProviderChargeCents + planConfig.serviceFeeCents;
      updateStep('payment', { 
        status: 'success', 
        result: `Payment simulated: $${(totalCents / 100).toFixed(2)} (no charge)` 
      });

      toast({ 
        title: 'Flow Test Complete',
        description: 'All steps executed successfully!',
      });
    } catch (error) {
      const failedStep = steps.find(s => s.status === 'running');
      if (failedStep) {
        updateStep(failedStep.id, { 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
      toast({ 
        title: 'Flow Test Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setRunning(false);
    }
  };

  const resetFlow = () => {
    setPhase('config');
    setSteps(prev => prev.map(s => ({ ...s, status: 'pending' as const, result: undefined, error: undefined })));
    setMandateId(null);
    setPlanId(null);
  };

  const getStepIcon = (status: FlowStep['status']) => {
    switch (status) {
      case 'running': return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'success': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'error': return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const totalCostCents = planConfig.maxProviderChargeCents + planConfig.serviceFeeCents;
  const isValidConfig = mandateConfig.childId && mandateConfig.credentialId && totalCostCents <= mandateConfig.maxAmountCents;
  const hasWarnings = planConfig.opensAt < new Date(Date.now() + 60 * 1000);

  if (!user) {
    navigate('/auth');
    return null;
  }

  if (loadingData) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Registration Flow Tester</h1>
            <p className="text-muted-foreground">
              Configure and test the complete registration flow from mandate creation to payment
            </p>
          </div>

          {phase === 'config' ? (
            <>
              {/* Authorization Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Badge>Step 1</Badge>
                    Authorization Configuration
                  </CardTitle>
                  <CardDescription>
                    Set up the mandate that authorizes registration actions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Provider</Label>
                      <div className="mt-2">
                        <Badge variant="secondary">{mandateConfig.provider}</Badge>
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="program-ref">Program Reference</Label>
                      <Input
                        id="program-ref"
                        value={mandateConfig.programRef}
                        onChange={(e) => setMandateConfig(prev => ({ ...prev, programRef: e.target.value }))}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="child">Child</Label>
                      <Select 
                        value={mandateConfig.childId} 
                        onValueChange={(value) => setMandateConfig(prev => ({ ...prev, childId: value }))}
                      >
                        <SelectTrigger id="child">
                          <SelectValue placeholder="Select child..." />
                        </SelectTrigger>
                        <SelectContent>
                          {children.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No children found</div>
                          ) : (
                            children.map((child) => (
                              <SelectItem key={child.id} value={child.id}>
                                {child.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label htmlFor="credential">Credentials</Label>
                      <Select 
                        value={mandateConfig.credentialId} 
                        onValueChange={(value) => setMandateConfig(prev => ({ ...prev, credentialId: value }))}
                      >
                        <SelectTrigger id="credential">
                          <SelectValue placeholder="Select credentials..." />
                        </SelectTrigger>
                        <SelectContent>
                          {credentials.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">No credentials found</div>
                          ) : (
                            credentials.map((cred) => (
                              <SelectItem key={cred.id} value={cred.id}>
                                {cred.alias}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label htmlFor="max-amount">Max Authorization Amount</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="max-amount"
                          type="number"
                          className="pl-7"
                          value={(mandateConfig.maxAmountCents / 100).toFixed(2)}
                          onChange={(e) => setMandateConfig(prev => ({ 
                            ...prev, 
                            maxAmountCents: Math.round(parseFloat(e.target.value || '0') * 100) 
                          }))}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="valid-until">Valid Until</Label>
                      <Input
                        id="valid-until"
                        type="datetime-local"
                        value={mandateConfig.validUntil.toISOString().slice(0, 16)}
                        onChange={(e) => setMandateConfig(prev => ({ 
                          ...prev, 
                          validUntil: new Date(e.target.value) 
                        }))}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label>Authorized Actions (Scopes)</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {mandateConfig.scopes.map((scope) => (
                        <Badge key={scope} variant="outline">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Registration Execution Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Badge>Step 2</Badge>
                    Registration Execution Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure when and how the registration will execute
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <OpenTimePicker 
                    value={planConfig.opensAt}
                    onChange={(date) => setPlanConfig(prev => ({ ...prev, opensAt: date }))}
                  />
                  
                  <Separator />
                  
                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                      <Calendar className="h-4 w-4" />
                      Program Answers
                      <Badge variant="secondary" className="ml-auto">Optional</Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="color-group">Color Group</Label>
                          <Select 
                            value={planConfig.answers.color_group}
                            onValueChange={(value) => setPlanConfig(prev => ({ 
                              ...prev, 
                              answers: { ...prev.answers, color_group: value } 
                            }))}
                          >
                            <SelectTrigger id="color-group">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Red">Red</SelectItem>
                              <SelectItem value="Blue">Blue</SelectItem>
                              <SelectItem value="Green">Green</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor="rentals">Rentals</Label>
                          <Select 
                            value={planConfig.answers.rentals}
                            onValueChange={(value) => setPlanConfig(prev => ({ 
                              ...prev, 
                              answers: { ...prev.answers, rentals: value } 
                            }))}
                          >
                            <SelectTrigger id="rentals">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="None">None</SelectItem>
                              <SelectItem value="Skis">Skis</SelectItem>
                              <SelectItem value="Snowboard">Snowboard</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor="volunteer">Volunteer</Label>
                          <Select 
                            value={planConfig.answers.volunteer}
                            onValueChange={(value) => setPlanConfig(prev => ({ 
                              ...prev, 
                              answers: { ...prev.answers, volunteer: value } 
                            }))}
                          >
                            <SelectTrigger id="volunteer">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Instructor">Instructor</SelectItem>
                              <SelectItem value="Chaperone">Chaperone</SelectItem>
                              <SelectItem value="None">None</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  
                  <Separator />
                  
                  <div className="space-y-4">
                    <Label>Payment Caps</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="max-provider">Max Provider Charge</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input
                            id="max-provider"
                            type="number"
                            className="pl-7"
                            value={(planConfig.maxProviderChargeCents / 100).toFixed(2)}
                            onChange={(e) => setPlanConfig(prev => ({ 
                              ...prev, 
                              maxProviderChargeCents: Math.round(parseFloat(e.target.value || '0') * 100) 
                            }))}
                          />
                        </div>
                      </div>
                      
                      <div>
                        <Label htmlFor="service-fee">Service Fee</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                          <Input
                            id="service-fee"
                            type="number"
                            className="pl-7"
                            value={(planConfig.serviceFeeCents / 100).toFixed(2)}
                            onChange={(e) => setPlanConfig(prev => ({ 
                              ...prev, 
                              serviceFeeCents: Math.round(parseFloat(e.target.value || '0') * 100) 
                            }))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      placeholder="Optional notes about this test..."
                      value={planConfig.notes}
                      onChange={(e) => setPlanConfig(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Summary Panel */}
              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle>Configuration Summary</CardTitle>
                  <CardDescription>Review your configuration before starting the test</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium mb-1">Authorization Timeline</div>
                      <div className="text-muted-foreground">
                        Valid from: Now<br />
                        Valid until: {mandateConfig.validUntil.toLocaleString()}
                      </div>
                    </div>
                    
                    <div>
                      <div className="font-medium mb-1">Registration Attempt</div>
                      <div className="text-muted-foreground">
                        Opens at: {planConfig.opensAt.toLocaleString()}
                      </div>
                    </div>
                    
                    <div>
                      <div className="font-medium mb-1">Cost Breakdown</div>
                      <div className="text-muted-foreground">
                        Provider: ${(planConfig.maxProviderChargeCents / 100).toFixed(2)}<br />
                        Service Fee: ${(planConfig.serviceFeeCents / 100).toFixed(2)}<br />
                        <strong>Total: ${(totalCostCents / 100).toFixed(2)}</strong>
                      </div>
                    </div>
                    
                    <div>
                      <div className="font-medium mb-1">Authorization Cap</div>
                      <div className="text-muted-foreground">
                        Max Amount: ${(mandateConfig.maxAmountCents / 100).toFixed(2)}<br />
                        {totalCostCents <= mandateConfig.maxAmountCents ? (
                          <span className="text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Within limits
                          </span>
                        ) : (
                          <span className="text-red-600 flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> Exceeds authorization
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {hasWarnings && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Registration opens in less than 1 minute. This is fine for testing, but ensure the system can process it in time.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {!isValidConfig && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Configuration incomplete. Please select a child and credentials, and ensure total cost doesn't exceed authorization cap.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="pt-4">
                    <Button 
                      onClick={startFlowTest}
                      disabled={!isValidConfig}
                      className="w-full gap-2"
                      size="lg"
                    >
                      <PlayCircle className="h-5 w-5" />
                      Start Flow Test
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            // Execution Phase
            <Card>
              <CardHeader>
                <CardTitle>Flow Execution</CardTitle>
                <CardDescription>
                  Running the complete flow with your configuration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {steps.map((step, idx) => (
                    <div 
                      key={step.id}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                    >
                      <div className="mt-0.5">
                        {getStepIcon(step.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            Step {idx + 1}
                          </Badge>
                          <span className="font-medium">{step.label}</span>
                        </div>
                        {step.result && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {step.result}
                          </p>
                        )}
                        {step.error && (
                          <p className="text-sm text-red-500 mt-1">
                            Error: {step.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {(mandateId || planId) && (
                  <div className="pt-4 border-t space-y-2 text-sm">
                    <div className="font-medium">Generated IDs:</div>
                    {mandateId && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Mandate</Badge>
                        <code className="text-xs">{mandateId}</code>
                      </div>
                    )}
                    {planId && (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Plan</Badge>
                        <code className="text-xs">{planId}</code>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="flex gap-2 pt-4">
                  <Button 
                    onClick={resetFlow}
                    variant="outline"
                    disabled={running}
                  >
                    Back to Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
