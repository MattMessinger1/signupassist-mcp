import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Session } from '@supabase/supabase-js';
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
import { Calendar, CalendarIcon, Shield, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Schema for form validation
const planBuilderSchema = z.object({
  programRef: z.string().min(1, 'Program reference is required'),
  childId: z.string().min(1, 'Child selection is required'),
  opensAt: z.date({ required_error: 'Date is required' }),
  maxAmountCents: z.number().min(1, 'Maximum amount must be at least $0.01'),
  answers: z.record(z.string()).optional(),
});

type PlanBuilderForm = z.infer<typeof planBuilderSchema>;

interface DiscoveredField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'number';
  required: boolean;
  options?: string[];
}

interface Branch {
  choice: string;
  questions: DiscoveredField[];
}

interface DiscoveredSchema {
  program_ref: string;
  branches: Branch[];
  common_questions?: DiscoveredField[];
}

interface Child {
  id: string;
  name: string;
  dob: string;
}

const PlanBuilder = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [discoveredSchema, setDiscoveredSchema] = useState<DiscoveredSchema | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isCreatingMandate, setIsCreatingMandate] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [prerequisiteChecks, setPrerequisiteChecks] = useState<any>(null);
  const [isCheckingPrerequisites, setIsCheckingPrerequisites] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<PlanBuilderForm>({
    resolver: zodResolver(planBuilderSchema),
    defaultValues: {
      answers: {},
    },
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

  // Load children when user is authenticated
  useEffect(() => {
    if (user) {
      loadChildren();
    }
  }, [user]);

  const loadChildren = async () => {
    try {
      const { data, error } = await supabase
        .from('children')
        .select('*')
        .order('name');

      if (error) throw error;
      setChildren(data || []);
    } catch (error) {
      console.error('Error loading children:', error);
      toast({
        title: 'Error',
        description: 'Failed to load children. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const discoverFields = async (programRef: string) => {
    setIsDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-plan-fields', {
        body: {
          program_ref: programRef,
          mandate_id: 'temp', // Temporary for discovery
          plan_execution_id: 'temp'
        }
      });

      if (error) throw error;
      setDiscoveredSchema(data);
    } catch (error) {
      console.error('Error discovering fields:', error);
      toast({
        title: 'Discovery Failed',
        description: 'Could not discover program fields. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const checkPrerequisites = async (childId?: string) => {
    if (!user) return;
    
    setIsCheckingPrerequisites(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-prerequisites', {
        body: {
          user_id: user.id,
          provider: 'skiclubpro',
          child_id: childId
        }
      });

      if (error) throw error;
      setPrerequisiteChecks(data);
      
      if (data.overall_status === 'blocked') {
        toast({
          title: 'Prerequisites Not Met',
          description: 'Please resolve the blocking issues before proceeding. Account/membership setup is not billable.',
          variant: 'destructive',
        });
      } else if (data.overall_status === 'warnings') {
        toast({
          title: 'Prerequisites Check Complete',
          description: 'Some warnings found, but you can proceed.',
        });
      }
      
      // Show specific messaging for account/membership issues
      const accountCheck = data.checks?.find((check: any) => check.type === 'skiclubpro_membership');
      if (accountCheck && accountCheck.status === 'failed') {
        toast({
          title: "SkiClubPro Account Required",
          description: "Account setup flows are not billable - only successful class signups incur the $20 fee.",
        });
      }
    } catch (error) {
      console.error('Error checking prerequisites:', error);
      toast({
        title: 'Prerequisites Check Failed',
        description: 'Could not verify account prerequisites.',
        variant: 'destructive',
      });
    } finally {
      setIsCheckingPrerequisites(false);
    }
  };

  const createMandate = async (formData: PlanBuilderForm) => {
    setIsCreatingMandate(true);
    try {
      // Bundle answers with mandate payload
      const mandatePayload = {
        user_id: user!.id,
        child_id: formData.childId,
        program_ref: formData.programRef,
        max_amount_cents: formData.maxAmountCents,
        valid_from: new Date().toISOString(),
        valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        provider: 'skiclubpro',
        scope: ['scp:login', 'scp:enroll', 'scp:pay', 'signupassist:fee'],
        answers: formData.answers,
      };

      // Create mandate in database
      const { data, error } = await supabase
        .from('mandates')
        .insert([{
          user_id: user!.id,
          child_id: formData.childId,
          program_ref: formData.programRef,
          max_amount_cents: formData.maxAmountCents,
          valid_from: new Date().toISOString(),
          valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          provider: 'skiclubpro',
          scope: ['scp:login', 'scp:enroll', 'scp:pay', 'signupassist:fee'],
          jws_compact: 'temp', // Will be updated with actual JWS
        }])
        .select()
        .single();

      if (error) throw error;

      // Create plan
      await supabase
        .from('plans')
        .insert([{
          user_id: user!.id,
          child_id: formData.childId,
          program_ref: formData.programRef,
          provider: 'skiclubpro',
          opens_at: formData.opensAt.toISOString(),
          mandate_id: data.id,
        }]);

      toast({
        title: 'Success',
        description: 'Plan created successfully! You will be notified when registration opens.',
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
    setShowConsent(true);
  };

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

  if (!user) {
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

  const selectedChild = children.find(c => c.id === form.watch('childId'));
  const currentBranch = discoveredSchema?.branches.find(b => b.choice === selectedBranch);
  const fieldsToShow = currentBranch?.questions || discoveredSchema?.common_questions || [];

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
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Program Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="programRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Program Reference</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input placeholder="e.g., blackhawk_winter" {...field} />
                          <Button 
                            type="button" 
                            variant="outline"
                            onClick={() => field.value && discoverFields(field.value)}
                            disabled={!field.value || isDiscovering}
                          >
                            {isDiscovering ? 'Discovering...' : 'Discover Fields'}
                          </Button>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Enter the program identifier from SkiClubPro
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
                      <div className="flex gap-2">
                        <Select onValueChange={(value) => {
                          field.onChange(value);
                          checkPrerequisites(value);
                        }} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select a child" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {children.map((child) => (
                              <SelectItem key={child.id} value={child.id}>
                                {child.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button 
                          type="button" 
                          variant="outline"
                          onClick={() => checkPrerequisites(field.value)}
                          disabled={!field.value || isCheckingPrerequisites}
                        >
                          {isCheckingPrerequisites ? 'Checking...' : 'Check Prerequisites'}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="opensAt"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Registration Opens</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-[240px] pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <CalendarComponent
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date < new Date()}
                            initialFocus
                            className="p-3 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxAmountCents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Program Cost (cents)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="50000" 
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormDescription>
                        Maximum amount you authorize for the program fee (in cents)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Prerequisites Check Results */}
            {prerequisiteChecks && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Prerequisites Check
                    {prerequisiteChecks.overall_status === 'ready' && <CheckCircle className="h-4 w-4 text-green-600" />}
                    {prerequisiteChecks.overall_status === 'blocked' && <AlertTriangle className="h-4 w-4 text-red-600" />}
                    {prerequisiteChecks.overall_status === 'warnings' && <AlertTriangle className="h-4 w-4 text-orange-600" />}
                  </CardTitle>
                  <CardDescription>
                    Account readiness verification for automated registration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {prerequisiteChecks.checks.map((check: any, index: number) => (
                    <div key={index} className="flex items-start gap-3 p-3 rounded-lg border">
                      {check.status === 'passed' && <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />}
                      {check.status === 'failed' && <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />}
                      {check.status === 'warning' && <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={check.status === 'passed' ? 'secondary' : check.status === 'failed' ? 'destructive' : 'outline'}>
                            {check.type.replace('_', ' ')}
                          </Badge>
                          {check.blocking && <Badge variant="destructive" className="text-xs">Blocking</Badge>}
                        </div>
                        <p className="text-sm mt-1">{check.message}</p>
                      </div>
                    </div>
                  ))}
                  {!prerequisiteChecks.can_proceed && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-800">
                        You cannot proceed with plan creation until all blocking issues are resolved.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Discovered Fields */}
            {discoveredSchema && (
              <Card>
                <CardHeader>
                  <CardTitle>Program Requirements</CardTitle>
                  <CardDescription>
                    Answer these questions now to enable automated registration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Branch Selection */}
                  {discoveredSchema.branches.length > 0 && (
                    <div>
                      <label className="text-sm font-medium">Program Type</label>
                      <Select onValueChange={setSelectedBranch} value={selectedBranch}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select program type" />
                        </SelectTrigger>
                        <SelectContent>
                          {discoveredSchema.branches.map((branch) => (
                            <SelectItem key={branch.choice} value={branch.choice}>
                              {branch.choice}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Dynamic Fields */}
                  {fieldsToShow.map((field) => (
                    <FormField
                      key={field.id}
                      control={form.control}
                      name={`answers.${field.id}` as any}
                      render={({ field: formField }) => (
                        <FormItem>
                          <FormLabel>
                            {field.label}
                            {field.required && <span className="text-destructive ml-1">*</span>}
                          </FormLabel>
                          <FormControl>
                            {field.type === 'select' ? (
                              <Select onValueChange={formField.onChange} defaultValue={formField.value}>
                                <SelectTrigger>
                                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options?.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : field.type === 'textarea' ? (
                              <Textarea placeholder={`Enter ${field.label.toLowerCase()}`} {...formField} />
                            ) : field.type === 'number' ? (
                              <Input type="number" placeholder="0" {...formField} />
                            ) : (
                              <Input placeholder={`Enter ${field.label.toLowerCase()}`} {...formField} />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Cost Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Cost Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>Provider Fee (SkiClubPro)</span>
                    <Badge variant="outline">
                      ${form.watch('maxAmountCents') ? (form.watch('maxAmountCents') / 100).toFixed(2) : '0.00'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Paid directly to SkiClubPro with your stored payment method
                  </p>
                </div>
                
                <Separator />
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span>SignupAssist Service Fee</span>
                    <Badge variant="secondary">$20.00</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Charged only on successful registration via Stripe
                  </p>
                </div>
              </CardContent>
            </Card>

            <Button type="submit" className="w-full" disabled={!discoveredSchema}>
              Create Signup Plan
            </Button>
          </form>
        </Form>

        {/* Consent Modal */}
        {showConsent && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Authorize Signup Plan
                </CardTitle>
                <CardDescription>
                  Review and approve the permissions for automated registration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Granted Permissions:</h4>
                  <ul className="space-y-1 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Login to SkiClubPro on your behalf
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Register {selectedChild?.name} for the program
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Complete payment using stored payment method
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-orange-600" />
                      Charge $20 SignupAssist fee only upon successful registration
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Charge $20 SignupAssist fee on success
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Cost Summary:</h4>
                  <div className="bg-muted p-3 rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span>Program Fee:</span>
                      <span>${(form.getValues('maxAmountCents') / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Service Fee:</span>
                      <span>$20.00</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setShowConsent(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => createMandate(form.getValues())}
                    disabled={isCreatingMandate || (prerequisiteChecks && !prerequisiteChecks.can_proceed)}
                    className="flex-1"
                  >
                    {isCreatingMandate ? 'Creating...' : 'Authorize & Create'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanBuilder;