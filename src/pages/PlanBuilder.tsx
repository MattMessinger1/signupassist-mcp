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
import { SavePaymentMethod } from '@/components/SavePaymentMethod';
import { FieldGroup } from '@/components/FieldGroup';
import { DraftSaver } from '@/components/DraftSaver';
import { EnhancedDiscoveredField } from '@/components/FieldRenderer';
import { useSmartDefaults } from '@/hooks/useSmartDefaults';
import { ProgramBrowser } from '@/components/ProgramBrowser';
import { PlanPreview } from '@/components/PlanPreview';
import { useRegistrationFlow } from '@/lib/registrationFlow';

const stripePromise = loadStripe('pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx');

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
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [createdPlan, setCreatedPlan] = useState<any>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [prerequisiteChecks, setPrerequisiteChecks] = useState<PrerequisiteCheck[]>([]);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [friendlyProgramTitle, setFriendlyProgramTitle] = useState<string | null>(null);

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

    // Validate programRef format
    console.log('PlanBuilder: discoverFields called with programRef:', programRef);
    if (programRef && programRef.includes(' ')) {
      console.error('PlanBuilder ERROR: programRef appears to be a title instead of text_ref:', programRef);
      toast({
        title: 'Invalid Program Reference',
        description: 'Program reference appears to be a title instead of a stable reference. Please reselect the program.',
        variant: 'destructive',
      });
      return;
    }

    setIsDiscovering(true);
    try {
      console.log('PlanBuilder: Calling discover-fields with validated programRef:', programRef);
      
      const payload = { 
        program_ref: programRef,
        credential_id: credentialId,
        plan_execution_id: null  // prevent invalid UUID error
      };
      
      console.log("DEBUG PlanBuilder sending payload:", payload);
      
      const { data, error } = await supabase.functions.invoke('discover-fields-interactive', {
        body: payload
      });

      if (error || data?.error) {
        const message = error?.message || data?.error || "Field discovery failed";
        toast({
          title: "Field Discovery Failed",
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

    setIsStartingJob(true);
    try {
      const { data, error } = await supabase.functions.invoke('start-signup-job', {
        body: { plan_id: planId }
      });

      if (error) throw error;

      toast({
        title: 'Signup Job Started',
        description: 'The automated signup process has begun. You can monitor progress in the execution logs.',
      });

      console.log('Signup job started:', data);
      
      // Navigate to dashboard after starting job
      setTimeout(() => navigate('/'), 2000);
    } catch (error) {
      console.error('Error starting signup job:', error);
      showFunctionError(error, 'Start Signup Job');
    } finally {
      setIsStartingJob(false);
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
          scope: ['scp:login', 'scp:enroll', 'scp:pay', 'scp:write:register', 'signupassist:fee'],
          credential_id: formData.credentialId
        }
      });

      if (error || data?.error) {
        const message = error?.message || data?.error || "Mandate creation failed";
        if (message.includes('Not authenticated')) {
          toast({
            title: 'Session Expired',
            description: 'Please log in again to continue.',
            variant: 'destructive',
          });
          navigate('/auth');
          return;
        }
        toast({
          title: "Mandate Creation Failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      // Create plan using the new create-plan function
      const { data: planData, error: planError } = await supabase.functions.invoke('create-plan', {
        body: {
          program_ref: formData.programRef,
          child_id: formData.childId,
          opens_at: formData.opensAt ? formData.opensAt.toISOString() : new Date().toISOString(),
          mandate_id: data.mandate_id,
          provider: 'skiclubpro',
          answers: formData.answers
        }
      });

      if (planError || planData?.error) {
        const message = planError?.message || planData?.error || "Plan creation failed";
        if (message.includes('Not authenticated')) {
          toast({
            title: 'Session Expired',
            description: 'Please log in again to continue.',
            variant: 'destructive',
          });
          navigate('/auth');
          return;
        }
        toast({
          title: "Plan Creation Failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      setCreatedPlan(planData);
      setShowConfirmation(true);
      toast({
        title: 'Plan Created Successfully',
        description: 'Your automated signup plan is ready. You can now start the registration process.',
      });

      // Log successful plan creation for debugging
      console.log('Plan created successfully:', {
        plan_id: planData.plan_id,
        program_ref: formData.programRef,
        child_id: formData.childId,
        mandate_id: data.mandate_id
      });
    } catch (error) {
      console.error('Error creating mandate:', error);
      const message = error instanceof Error ? error.message : 'Failed to create plan. Please try again.';
      toast({
        title: 'Plan Creation Failed',
        description: message,
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

  // Show confirmation screen after successful plan creation
  if (showConfirmation && createdPlan) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-8 px-4 max-w-2xl">
          <div className="text-center mb-8">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-green-700 mb-2">Plan Created Successfully!</h1>
            <p className="text-muted-foreground">
              Your automated signup plan is ready and scheduled.
            </p>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Plan Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="flex justify-between">
                  <span className="font-medium">Plan ID:</span>
                  <span className="font-mono text-sm">{createdPlan.plan_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Program:</span>
                  <span>{form.getValues('programRef')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Opens At:</span>
                  <span>{new Date(createdPlan.opens_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Status:</span>
                  <Badge variant="secondary">{createdPlan.status}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex gap-3">
              <Button 
                onClick={() => startSignupJob(createdPlan.plan_id)}
                disabled={isStartingJob}
                className="flex-1"
                size="lg"
              >
                {isStartingJob ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting Job...
                  </>
                ) : (
                  'Start Signup Job'
                )}
              </Button>
            </div>
            
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => navigate('/')}
                className="flex-1"
              >
                Go to Dashboard
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowConfirmation(false);
                  setCreatedPlan(null);
                  form.reset();
                  setDiscoveredSchema(null);
                  setPrerequisiteChecks([]);
                }}
                className="flex-1"
              >
                Create Another Plan
              </Button>
            </div>
          </div>

          <Alert className="mt-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Next Steps:</strong> Click "Start Signup Job" to begin the automated registration process, 
              or return to the dashboard to manage your plans.
            </AlertDescription>
          </Alert>
        </div>
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Login Credentials */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Login Credentials
                </CardTitle>
                <CardDescription>
                  Select the login credentials to use for automated registration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="credentialId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stored Credentials</FormLabel>
                      <FormControl>
                        <CredentialPicker
                          value={field.value}
                          onChange={field.onChange}
                          provider="skiclubpro"
                        />
                      </FormControl>
                      <FormDescription>
                        These credentials will be used to log into the registration system
                      </FormDescription>
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
                  Select the program and child for automated registration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="programRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Program Selection</FormLabel>
                      <FormControl>
                        <ProgramBrowser
                          onProgramSelect={({ ref, title }) => {
                            field.onChange(ref);       // pass text_ref to backend
                            setFriendlyProgramTitle(title); // save human-friendly title
                            setDiscoveredSchema(null);
                            setSelectedBranch('');
                          }}
                          selectedProgram={field.value}
                        />
                      </FormControl>
                      <FormDescription>
                        Browse and select the program you want to register for
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
                        <ChildSelect
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Select which child to register for this program
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="opensAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration Opens At</FormLabel>
                      <FormControl>
                        <OpenTimePicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        When should the automated signup begin? (must be in the future)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch('programRef') && form.watch('credentialId') && (
                  <div className="pt-4">
                    <Button
                      type="button"
                      onClick={() => discoverFields(form.getValues('programRef'))}
                      disabled={isDiscovering}
                      variant="outline"
                      className="w-full"
                    >
                      {isDiscovering ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Discovering Fields...
                        </>
                      ) : (
                        'Load Registration Form'
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Prerequisites Panel */}
            {discoveredSchema && (
              <PrereqsPanel
                provider="skiclubpro"
                childId={selectedChildId}
                credentialId={form.watch('credentialId')}
                onResultsChange={setPrerequisiteChecks}
              />
            )}

            {/* Payment Method */}
            {prerequisiteChecks.length > 0 && (
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
                  <SavePaymentMethod 
                    onPaymentMethodSaved={() => {
                      setHasPaymentMethod(true);
                      checkPaymentMethod();
                    }}
                    hasPaymentMethod={hasPaymentMethod}
                  />
                </CardContent>
              </Card>
            )}

            {/* Discovered Fields */}
            {discoveredSchema && (
              <Card>
                <CardHeader>
                  <CardTitle>Registration Form</CardTitle>
                  <CardDescription>
                    Complete the required information for automated registration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Branch Selection */}
                  {discoveredSchema.branches && discoveredSchema.branches.length > 1 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Program Options</label>
                      <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a program option" />
                        </SelectTrigger>
                        <SelectContent>
                          {discoveredSchema.branches.map((branch, index) => (
                            <SelectItem key={index} value={branch.choice}>
                              {branch.choice}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Render fields grouped by category */}
                  {Object.entries(fieldsByCategory).map(([category, fields]) => (
                    <FieldGroup
                      key={category}
                      title={category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      category={category}
                      fields={fields}
                      control={form.control}
                      watch={form.watch}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Plan Preview */}
            {discoveredSchema && allFields.length > 0 && (
              <PlanPreview
                programRef={friendlyProgramTitle || form.watch('programRef')}
                childName="Selected Child"
                opensAt={opensAt}
                selectedBranch={selectedBranch}
                answers={form.watch('answers') || {}}
                discoveredFields={allFields}
                credentialAlias="Login Credentials"
              />
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/')}
                className="flex-1"
              >
                Cancel
              </Button>
              
              <Button
                type="submit"
                disabled={isCreatingMandate || !discoveredSchema}
                className="flex-1"
              >
                {isCreatingMandate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Plan...
                  </>
                ) : (
                  'Create Plan'
                )}
              </Button>
            </div>
          </form>
        </Form>

        {/* Draft Saver */}
        <DraftSaver
          formData={{
            programRef: form.watch('programRef'),
            childId: form.watch('childId'),
            opensAt: form.watch('opensAt'),
            credentialId: form.watch('credentialId'),
            answers: form.watch('answers')
          }}
          watch={form.watch}
          setValue={form.setValue}
          draftKey="plan-builder"
        />

        {/* Consent Modal */}
        <ConsentModal
          open={showConsent}
          onClose={() => setShowConsent(false)}
          onApprove={(maxCostCents) => createMandate(maxCostCents)}
          programRef={friendlyProgramTitle || form.watch('programRef')}
          childName="Selected Child"
          scopes={['scp:login', 'scp:enroll', 'scp:pay', 'scp:write:register', 'signupassist:fee']}
          loading={isCreatingMandate}
        />
      </div>
    </div>
  );
};

export default function PlanBuilderWithStripe() {
  return (
    <Elements stripe={stripePromise}>
      <PlanBuilder />
    </Elements>
  );
}