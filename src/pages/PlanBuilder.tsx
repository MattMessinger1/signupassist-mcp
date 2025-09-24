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
import { Shield, DollarSign, AlertTriangle, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ChildSelect } from '@/components/ChildSelect';
import { OpenTimePicker } from '@/components/OpenTimePicker';
import { CredentialPicker } from '@/components/CredentialPicker';
import { PrereqsPanel } from '@/components/PrereqsPanel';
import { ConsentModal } from '@/components/ConsentModal';
import { PaymentMethodSetup } from '@/components/PaymentMethodSetup';

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
  dob: string | null;
}

interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail' | 'unknown';
  message?: string;
}

const PlanBuilder = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [discoveredSchema, setDiscoveredSchema] = useState<DiscoveredSchema | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isCreatingMandate, setIsCreatingMandate] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [prerequisiteChecks, setPrerequisiteChecks] = useState<PrerequisiteCheck[]>([]);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
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

  const discoverFields = async (programRef: string) => {
    setIsDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-plan-fields', {
        body: { program_ref: programRef }
      });

      if (error) throw error;
      setDiscoveredSchema(data);
      toast({
        title: 'Fields Discovered',
        description: `Found ${data.branches?.length || 0} program options.`,
      });
    } catch (error) {
      console.error('Error discovering fields:', error);
      toast({
        title: 'Discovery Failed',
        description: 'Could not load program-specific fields.',
        variant: 'destructive',
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const createMandate = async (maxCostCents: number) => {
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

      if (error) throw error;

      // Create plan using the new create-plan function
      const { data: planData, error: planError } = await supabase.functions.invoke('create-plan', {
        body: {
          program_ref: formData.programRef,
          child_id: formData.childId,
          opens_at: formData.opensAt.toISOString(),
          mandate_id: data.mandate_id,
          provider: 'skiclubpro'
        }
      });

      if (planError) throw planError;

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

  const currentBranch = discoveredSchema?.branches.find(b => b.choice === selectedBranch);
  const fieldsToShow = currentBranch?.questions || discoveredSchema?.common_questions || [];
  const selectedChild = form.watch('childId');

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
                      <FormControl>
                        <ChildSelect
                          value={field.value}
                          onChange={field.onChange}
                        />
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
                      <FormLabel>Registration Opens</FormLabel>
                      <FormControl>
                        <OpenTimePicker
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

            {/* Prerequisites */}
            {form.watch('credentialId') && (
              <PrereqsPanel
                provider="skiclubpro"
                credentialId={form.watch('credentialId')}
                onResultsChange={setPrerequisiteChecks}
              />
            )}

            {/* Payment Method Setup */}
            <PaymentMethodSetup
              onPaymentMethodSaved={checkPaymentMethod}
              hasPaymentMethod={hasPaymentMethod}
            />

            {/* Program-specific Fields */}
            {discoveredSchema && (
              <Card>
                <CardHeader>
                  <CardTitle>Program Details</CardTitle>
                  <CardDescription>
                    Complete the required information for {discoveredSchema.program_ref}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {discoveredSchema.branches && discoveredSchema.branches.length > 0 && (
                    <div>
                      <FormLabel>Program Type</FormLabel>
                      <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select program type..." />
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

                  {fieldsToShow.map((field) => (
                    <FormField
                      key={field.id}
                      control={form.control}
                      name={`answers.${field.id}`}
                      render={({ field: formField }) => (
                        <FormItem>
                          <FormLabel>
                            {field.label} {field.required && '*'}
                          </FormLabel>
                          <FormControl>
                            {field.type === 'select' ? (
                              <Select value={formField.value} onValueChange={formField.onChange}>
                                <SelectTrigger>
                                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
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
                              <Textarea {...formField} placeholder={`Enter ${field.label.toLowerCase()}`} />
                            ) : field.type === 'number' ? (
                              <Input {...formField} type="number" placeholder={`Enter ${field.label.toLowerCase()}`} />
                            ) : (
                              <Input {...formField} placeholder={`Enter ${field.label.toLowerCase()}`} />
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

            {/* Submit */}
            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => navigate('/')}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!discoveredSchema || prerequisiteChecks.length === 0 || !prerequisiteChecks.every(check => check.status === 'pass') || !hasPaymentMethod}
              >
                Create Plan
              </Button>
            </div>
          </form>
        </Form>

        {/* Consent Modal */}
        <ConsentModal
          open={showConsent}
          onClose={() => setShowConsent(false)}
          onApprove={createMandate}
          programRef={form.watch('programRef')}
          childName="Selected Child"
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