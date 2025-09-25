import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Session } from '@supabase/supabase-js';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Shield, DollarSign, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ChildSelect } from '@/components/ChildSelect';
import { OpenTimePicker } from '@/components/OpenTimePicker';
import { CredentialPicker } from '@/components/CredentialPicker';
import { PrereqsPanel } from '@/components/PrereqsPanel';
import { ConsentModal } from '@/components/ConsentModal';
import { PaymentMethodSetup } from '@/components/PaymentMethodSetup';
import { FieldGroup } from '@/components/FieldGroup';
import { DraftSaver } from '@/components/DraftSaver';
import { EnhancedDiscoveredField } from '@/components/FieldRenderer';
import { useSmartDefaults } from '@/hooks/useSmartDefaults';
import { PlanPreview } from '@/components/PlanPreview';
import { useRegistrationFlow } from '@/lib/registrationFlow';

const stripePromise = loadStripe('pk_test_51QaUhLLyGRQVXFaLxe3Ygv0wfVr8z6FTKFqCJ9Lw6dAI1PTWT1NCGSSHDhtYN8lFyR35gKP5CJH8djqXEp3qfaLp00XFMN5cPE');

// Schema for form validation
const planBuilderSchema = z.object({
  programRef: z.string().min(1, 'Program reference is required'),
  childId: z.string().min(1, 'Child selection is required'),
  opensAt: z.date({ message: 'Date is required' }),
  credentialId: z.string().min(1, 'Login credentials are required'),
  answers: z.record(z.string(), z.string()).optional(),
});

type PlanBuilderForm = z.infer<typeof planBuilderSchema>;

interface DiscoveredField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'number' | 'date' | 'checkbox' | 'radio' | 'file' | 'multi-select';
  required: boolean;
  options?: string[];
  category?: 'child_info' | 'program_selection' | 'legal_waivers' | 'emergency_contacts' | 'payment_preferences';
  placeholder?: string;
  description?: string;
  dependsOn?: string;
  showWhen?: string;
}

interface Branch {
  choice: string;
  questions: EnhancedDiscoveredField[];
}

interface DiscoveredSchema {
  program_ref: string;
  branches: Branch[];
  common_questions?: EnhancedDiscoveredField[];
}

interface Child {
  id: string;
  name: string;
  dob: string | null;
}

interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail' | 'unknown';
  message?: string;
}

const PlanBuilder = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY
  const form = useForm<PlanBuilderForm>({
    resolver: zodResolver(planBuilderSchema),
    defaultValues: {
      answers: {},
    },
  });

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [discoveredSchema, setDiscoveredSchema] = useState<DiscoveredSchema | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isCreatingMandate, setIsCreatingMandate] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [createdPlan, setCreatedPlan] = useState<any>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [prerequisiteChecks, setPrerequisiteChecks] = useState<PrerequisiteCheck[]>([]);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);

  // Safe derived variables with null checks and defaults
  const currentBranch = discoveredSchema?.branches?.find(b => b.choice === selectedBranch) ?? null;
  const fieldsToShow = currentBranch?.questions ?? discoveredSchema?.common_questions ?? [];
  const selectedChildId = form.watch('childId') ?? '';
  const opensAt = form.watch('opensAt') ?? null;

  // Debug logging for troubleshooting
  console.log('PlanBuilder Debug:', {
    discoveredSchema,
    prerequisiteChecks,
    formWatchChildId: form.watch('childId'),
    formWatchOpensAt: form.watch('opensAt'),
    formWatchAnswers: form.watch('answers'),
    selectedChildId,
    currentBranch,
    fieldsToShow: fieldsToShow.length
  });

  const allFields = [
    ...(discoveredSchema?.common_questions || []),
    ...(currentBranch?.questions || [])
  ];
  
  // Group fields by category with safe access
  const fieldsByCategory = allFields.reduce((acc, field) => {
    const category = field?.category || 'program_selection';
    if (!acc[category]) acc[category] = [];
    acc[category].push(field);
    return acc;
  }, {} as Record<string, EnhancedDiscoveredField[]>);

  // Apply smart defaults when fields are discovered
  useSmartDefaults({
    fields: allFields,
    childId: selectedChildId,
    setValue: form.setValue,
    watch: form.watch,
  });

  // Authentication setup
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Redirect to auth if signed out
        if (event === 'SIGNED_OUT' || !session) {
          navigate('/auth');
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      // Redirect to auth if no session
      if (!session) {
        navigate('/auth');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Check for payment method
  useEffect(() => {
    if (user) {
      checkPaymentMethod();
    }
  }, [user]);

  const checkPaymentMethod = async () => {
    if (!user) return;
    
    setCheckingPayment(true);
    try {
      const { data, error } = await supabase
        .from('user_billing')
        .select('default_payment_method_id')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      setHasPaymentMethod(!!data?.default_payment_method_id);
    } catch (error) {
      console.error('Error checking payment method:', error);
    } finally {
      setCheckingPayment(false);
    }
  };

  // Helper function for showing function errors
  const showFunctionError = (error: any, action: string) => {
    const message = error?.message || `${action} failed. Please try again.`;
    toast({
      title: `${action} Failed`,
      description: message,
      variant: 'destructive',
    });
  };

  const discoverFields = async (programRef: string) => {
    if (!user || !session) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to discover fields.',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    const credentialId = form.getValues('credentialId');
    if (!credentialId) {
      toast({
        title: 'Credentials Required',
        description: 'Please select login credentials first.',
        variant: 'destructive',
      });
      return;
    }

    setIsDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-fields-interactive', {
        body: { 
          program_ref: programRef,
          credential_id: credentialId 
        }
      });

      if (error) {
        const message = (error as any)?.message || (error as any)?.context?.statusText || "Discover Fields failed";
        toast({
          title: "Discover Fields Failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      if (!data || (data as any).error) {
        const message = (data as any)?.error || "Discover Fields failed";
        toast({
          title: "Discover Fields Failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      setDiscoveredSchema(data);
      
      const branchCount = data.branches?.length || 0;
      const commonQuestions = data.common_questions?.length || 0;
      toast({
        title: 'Fields Discovered Successfully',
        description: `Found ${branchCount} program options${commonQuestions > 0 ? ` and ${commonQuestions} common questions` : ''}.`,
      });
    } catch (error) {
      console.error('Error discovering fields:', error);
      const err = error as any;
      toast({
        title: "Discover Fields Failed",
        description: err.message || err.context || JSON.stringify(err),
        variant: "destructive",
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const startSignupJob = async (planId: string) => {
    if (!user || !session) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to start a signup job.',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    setIsCreatingPlan(true);
    try {
      const { data, error } = await supabase.functions.invoke('start-signup-job', {
        body: { plan_id: planId }
      });

      if (error) throw error;

      toast({
        title: 'Signup Job Started',
        description: 'Signup job started. You can monitor progress in Execution Logs.',
      });

      console.log('Signup job started:', data);
    } catch (error) {
      console.error('Error starting signup job:', error);
      showFunctionError(error, 'Start Signup Job');
    } finally {
      setIsCreatingPlan(false);
    }
  };

  const createMandate = async (maxCostCents: number) => {
    if (!user || !session) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to create a plan.',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    setIsCreatingMandate(true);
    try {
      const formData = form.getValues();
      
      // Create mandate using edge function
      const { data, error } = await supabase.functions.invoke('mandate-issue', {
        body: {
          child_id: formData.childId,
          program_ref: formData.programRef,
          max_amount_cents: maxCostCents,
          valid_from: new Date().toISOString(),
          valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
          provider: 'skiclubpro',
          scope: ['scp:login', 'scp:enroll', 'scp:pay', 'signupassist:fee'],
          credential_id: formData.credentialId
        }
      });

      if (error) {
        if (error.message?.includes('Not authenticated')) {
          toast({
            title: 'Session Expired',
            description: 'Please log in again to continue.',
            variant: 'destructive',
          });
          navigate('/auth');
          return;
        }
        throw error;
      }

      // Create plan using the new create-plan function
      const { data: planData, error: planError } = await supabase.functions.invoke('create-plan', {
        body: {
          program_ref: formData.programRef,
          child_id: formData.childId,
          opens_at: formData.opensAt ? formData.opensAt.toISOString() : new Date().toISOString(),
          mandate_id: data.mandate_id,
          provider: 'skiclubpro'
        }
      });

      if (planError) {
        if (planError.message?.includes('Not authenticated')) {
          toast({
            title: 'Session Expired',
            description: 'Please log in again to continue.',
            variant: 'destructive',
          });
          navigate('/auth');
          return;
        }
        throw planError;
      }

      setCreatedPlan(planData);
      toast({
        title: 'Plan Created',
        description: 'Your plan has been created. Click "Start Signup Job" to begin execution.',
      });

      // Log successful plan creation for debugging
      console.log('Plan created successfully:', {
        plan_id: planData.plan_id,
        program_ref: formData.programRef,
        child_id: formData.childId,
        mandate_id: data.mandate_id
      });

      navigate('/');
    } catch (error) {
      console.error('Error creating mandate:', error);
      toast({
        title: 'Error',
        description: 'Failed to create plan. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingMandate(false);
      setShowConsent(false);
    }
  };

  const onSubmit = (data: PlanBuilderForm) => {
    // Check prerequisites first
    const allPassed = prerequisiteChecks.every(check => check.status === 'pass');
    if (!allPassed) {
      toast({
        title: 'Prerequisites Required',
        description: 'Please ensure all prerequisites are met before creating the plan.',
        variant: 'destructive',
      });
      return;
    }

    // Check payment method
    if (!hasPaymentMethod) {
      toast({
        title: 'Payment Method Required',
        description: 'Please add a payment method for the $20 success fee before creating the plan.',
        variant: 'destructive',
      });
      return;
    }

    setShowConsent(true);
  };

  // EARLY RETURNS AFTER ALL HOOKS
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Please log in to create signup plans for your children.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/auth')} className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Signup Plan</h1>
          <p className="text-muted-foreground">
            Set up automated registration for your child's program
          </p>
        </div>

        {/* Membership Warning */}
        <Alert className="mb-6 border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="text-orange-800">
            <strong>Important:</strong> You must already be a member of Blackhawk Ski Club to register.
            If not, please purchase membership before creating this plan.
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Credentials */}
            <Card>
              <CardHeader>
                <CardTitle>Login Credentials</CardTitle>
                <CardDescription>
                  Select stored login credentials for SkiClubPro
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="credentialId"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <CredentialPicker
                          provider="skiclubpro"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Program Information */}
            <Card>
              <CardHeader>
                <CardTitle>Program Information</CardTitle>
                <CardDescription>
                  Specify the program and child details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="programRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Program Reference</FormLabel>
                      <FormControl>
                        <div className="flex space-x-2">
                          <Input
                            placeholder="e.g., blackhawk_winter_2024"
                            {...field}
                          />
                          <Button 
                            type="button" 
                            onClick={() => discoverFields(field.value)}
                            disabled={!field.value || isDiscovering}
                          >
                            {isDiscovering ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Discovering...
                              </>
                            ) : (
                              'Discover Fields'
                            )}
                          </Button>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Enter the program reference and click "Discover Fields" to load program-specific questions
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="childId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Child</FormLabel>
                      <FormControl>
                        <ChildSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="opensAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opens At</FormLabel>
                      <FormControl>
                        <OpenTimePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormDescription>
                        When registration opens (automatically submit at this time)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Prerequisites Panel */}
            <PrereqsPanel
              provider="skiclubpro"
              credentialId={form.watch('credentialId')}
              childId={form.watch('childId') || ''}
              onResultsChange={setPrerequisiteChecks}
            />

            {/* Payment Method */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Payment Method
                </CardTitle>
                <CardDescription>
                  Set up payment for the $20 success fee
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PaymentMethodSetup 
                  onPaymentMethodSaved={checkPaymentMethod}
                  hasPaymentMethod={hasPaymentMethod}
                />
              </CardContent>
            </Card>

            {/* Discovered Fields */}
            {discoveredSchema && (
              <>
                {/* Branch Selection */}
                {discoveredSchema.branches && discoveredSchema.branches.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Program Options</CardTitle>
                      <CardDescription>
                        Select your program option to see relevant questions
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a program option" />
                        </SelectTrigger>
                        <SelectContent>
                          {discoveredSchema.branches.map((branch) => (
                            <SelectItem key={branch.choice} value={branch.choice}>
                              {branch.choice}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                )}

                {/* Discovered Field Groups */}
                <div className="space-y-6">
                  {Object.entries(fieldsByCategory).map(([category, fields]) => {
                    const categoryTitles = {
                      child_info: 'Child Information',
                      program_selection: 'Program Selection',
                      legal_waivers: 'Legal Waivers & Consents',
                      emergency_contacts: 'Emergency Contacts',
                      payment_preferences: 'Payment Preferences',
                    };

                    const categoryDescriptions = {
                      child_info: 'Information about your child',
                      program_selection: 'Program-specific selections and preferences',
                      legal_waivers: 'Required waivers and legal consents',
                      emergency_contacts: 'Emergency contact information',
                      payment_preferences: 'Payment and billing preferences',
                    };

                    return (
                      <FieldGroup
                        key={category}
                        title={categoryTitles[category as keyof typeof categoryTitles] || 'Other Fields'}
                        description={categoryDescriptions[category as keyof typeof categoryDescriptions]}
                        fields={fields}
                        control={form.control}
                        watch={form.watch}
                        category={category}
                        defaultOpen={category === 'child_info' || category === 'program_selection'}
                      />
                    );
                  })}
                </div>

                {/* Plan Preview */}
                {allFields.length > 0 && discoveredSchema && (
                  <PlanPreview
                    programRef={discoveredSchema.program_ref}
                    childName={selectedChildId ? 'Selected Child' : 'No child selected'}
                    opensAt={opensAt ? opensAt : null}
                    selectedBranch={selectedBranch}
                    answers={form.watch('answers') || {}}
                    discoveredFields={allFields}
                    credentialAlias={form.watch('credentialId') ? 'Selected Credentials' : 'No credentials'}
                  />
                )}
              </>
            )}

            {/* Submit */}
            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => navigate('/')}>
                Cancel
              </Button>
              <div className="space-y-2">
                <Button 
                  type="submit" 
                  disabled={!discoveredSchema || prerequisiteChecks.length === 0 || !prerequisiteChecks.every(check => check.status === 'pass') || !hasPaymentMethod || isCreatingPlan}
                >
                  {isCreatingPlan ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Plan...
                    </>
                  ) : (
                    'Create Plan ($20)'
                  )}
                </Button>
                
                {createdPlan && (
                  <Button 
                    type="button"
                    onClick={() => startSignupJob(createdPlan.plan_id)}
                    disabled={isCreatingPlan}
                    variant="outline"
                    className="w-full"
                  >
                    {isCreatingPlan ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting Job...
                      </>
                    ) : (
                      'Start Signup Job'
                    )}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>

        {/* Consent Modal */}
        <ConsentModal
          open={showConsent}
          onClose={() => setShowConsent(false)}
          onApprove={createMandate}
          programRef={form.watch('programRef') || ''}
          childName={selectedChildId ? 'Selected Child' : 'No child selected'}
          scopes={['scp:login', 'scp:enroll', 'scp:pay', 'signupassist:fee']}
          loading={isCreatingMandate}
        />
      </div>
    </div>
  );
};

const PlanBuilderWithStripe = () => {
  return (
    <Elements stripe={stripePromise}>
      <PlanBuilder />
    </Elements>
  );
};

export default PlanBuilderWithStripe;