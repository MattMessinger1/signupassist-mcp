import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Shield, DollarSign, AlertTriangle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { ChildSelect } from '@/components/ChildSelect';
import { OpenTimePicker } from '@/components/OpenTimePicker';
import { CredentialPicker } from '@/components/CredentialPicker';
import PrerequisitesPanel from '@/components/PrereqsPanel';
import ProgramQuestionsPanel, { ProgramQuestion } from '@/components/ProgramQuestionsPanel';
import CompletionPanel from '@/components/CompletionPanel';
import StepIndicator from '@/components/StepIndicator';
import { ConsentModal } from '@/components/ConsentModal';
import { SavePaymentMethod } from '@/components/SavePaymentMethod';
import { FieldGroup } from '@/components/FieldGroup';
import { DraftSaver } from '@/components/DraftSaver';
import { EnhancedDiscoveredField } from '@/components/FieldRenderer';
import { useSmartDefaults } from '@/hooks/useSmartDefaults';
import { ProgramBrowser } from '@/components/ProgramBrowser';
import { PlanPreview } from '@/components/PlanPreview';
import { useRegistrationFlow } from '@/lib/registrationFlow';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import MandateSummary from '@/components/MandateSummary';
import { prompts, fmt } from '@/lib/prompts';
import { useToastLogger } from '@/lib/logging/useToastLogger';
import { chooseDefaultAnswer } from '@/lib/smartDefaults';
import { DiscoveryCoverage } from '@/components/DiscoveryCoverage';
import { mcpDiscover } from '@/lib/mcp';
import { PlanExecutionStatus } from '@/components/PlanExecutionStatus';

const stripePromise = loadStripe('pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx');

// Schema for form validation
const planBuilderSchema = z.object({
  programRef: z.string().min(1, 'Program reference is required'),
  childId: z.string().min(1, 'Child selection is required'),
  opensAt: z.date({ message: 'Date is required' }),
  credentialId: z.string().min(1, 'Login credentials are required'),
  maxAmountCents: z.number().min(0, 'Payment limit must be positive'),
  contactPhone: z.string().min(10, 'Please enter a valid mobile number'),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
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
  discoveryCompleted?: boolean; // Track if discovery has run
}

interface Child {
  id: string;
  name: string;
  dob: string | null;
}

interface PrerequisiteCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'unknown';
  message: string;
  fields?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
    category?: string;
  }>;
}

const PlanBuilder = () => {
  console.log('[PlanBuilder] Component mounting/rendering');
  const navigate = useNavigate();
  const { toast } = useToast();
  const toastLogger = useToastLogger();
  
  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY
  const form = useForm<PlanBuilderForm>({
    resolver: zodResolver(planBuilderSchema),
    defaultValues: {
      answers: {},
      maxAmountCents: 0,
      contactPhone: '',
    },
  });

  const { user, session, loading: authLoading, isSessionValid } = useAuth();
  console.log('[PlanBuilder] Auth state:', { hasUser: !!user, hasSession: !!session, authLoading });
  const [discoveredSchema, setDiscoveredSchema] = useState<DiscoveredSchema | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isCreatingMandate, setIsCreatingMandate] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [createdPlan, setCreatedPlan] = useState<any>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [prerequisiteChecks, setPrerequisiteChecks] = useState<PrerequisiteCheck[]>([]);
  const [prerequisiteStatus, setPrerequisiteStatus] = useState<'complete' | 'required' | 'unknown'>('unknown');
  const [prerequisiteFields, setPrerequisiteFields] = useState<EnhancedDiscoveredField[]>([]);
  const [programQuestions, setProgramQuestions] = useState<ProgramQuestion[]>([]);
  const [programDiscoveryRunning, setProgramDiscoveryRunning] = useState(false);
  const [activeStep, setActiveStep] = useState<'prereqs' | 'program' | 'completed'>('prereqs');
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [friendlyProgramTitle, setFriendlyProgramTitle] = useState<string | null>(null);
  const [selectedChildName, setSelectedChildName] = useState<string>('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [detectedPriceCents, setDetectedPriceCents] = useState<number | null>(null);
  const [caps, setCaps] = useState<{ max_provider_charge_cents: number | null; service_fee_cents: number | null }>({
    max_provider_charge_cents: null,
    service_fee_cents: 2000 // $20 success fee
  });
  const [showMandateSummary, setShowMandateSummary] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<{
    status: 'idle' | 'running' | 'success' | 'failed' | 'credential_invalid' | 'mandate_missing' | 'verified';
    message?: string;
    result?: string;
    verified?: boolean;
  }>({ status: 'idle' });
  const [loginStatus, setLoginStatus] = useState<'checking' | 'authenticated' | 'action_needed'>('checking');
  const [mvpTestProgress, setMvpTestProgress] = useState<{
    inProgress: boolean;
    stage: 'idle' | 'checking_mandates' | 'discovering_fields' | 'submitting_form' | 'complete' | 'error';
    message?: string;
  }>({ inProgress: false, stage: 'idle' });
  const [discoveryMetadata, setDiscoveryMetadata] = useState<any>(null);

  // Safe derived variables with null checks and defaults
  const currentBranch = discoveredSchema?.branches?.find(b => b.choice === selectedBranch) ?? null;
  const fieldsToShow = currentBranch?.questions ?? discoveredSchema?.common_questions ?? [];
  const selectedChildId = form.watch('childId') ?? '';
  const opensAt = form.watch('opensAt') ?? null;

  // Debug logging for troubleshooting
  const formWatchOpensAt = form.watch('opensAt');
  console.log('[PlanBuilder] Render state:', {
    authState: { hasUser: !!user, hasSession: !!session, authLoading },
    discoveredSchema: discoveredSchema ? {
      isNull: false,
      hasBranches: !!discoveredSchema.branches,
      branchCount: discoveredSchema.branches?.length ?? 0,
      hasCommonQuestions: !!discoveredSchema.common_questions,
      commonQuestionsCount: discoveredSchema.common_questions?.length ?? 0,
    } : { isNull: true },
    formState: {
      childId: form.watch('childId'),
      programRef: form.watch('programRef'),
      credentialId: form.watch('credentialId'),
      opensAt: formWatchOpensAt,
      opensAtType: typeof formWatchOpensAt,
      opensAtIsDate: formWatchOpensAt instanceof Date,
      opensAtValid: formWatchOpensAt instanceof Date && !isNaN(formWatchOpensAt.getTime()),
    },
    prerequisiteChecks: prerequisiteChecks.length,
    selectedChildId,
    currentBranch: !!currentBranch,
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

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Redirect to auth if not authenticated or session invalid
  useEffect(() => {
    if (!authLoading) {
      if (!user || !session) {
        console.warn('[PlanBuilder] No user/session, redirecting to auth');
        navigate('/auth');
      } else if (!isSessionValid()) {
        console.warn('[PlanBuilder] Session invalid, redirecting to auth');
        toast({
          title: 'Session Expired',
          description: 'Your session has expired. Please log in again.',
          variant: 'destructive',
        });
        navigate('/auth');
      }
    }
  }, [user, session, authLoading, navigate, isSessionValid, toast]);

  // Check for payment method
  useEffect(() => {
    if (user) {
      checkPaymentMethod();
    }
  }, [user]);

  // Realtime subscription for plan executions and execution logs
  // This enables automatic UI updates when backend processes complete
  // - Plan executions: tracks overall registration status
  // - Execution logs: provides detailed step-by-step progress including login verification
  useEffect(() => {
    if (!createdPlan?.plan_id) return;

    console.log('[PlanBuilder] Setting up realtime subscriptions for plan:', createdPlan.plan_id);

    const channel = supabase
      .channel('plan-execution-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'plan_executions',
          filter: `plan_id=eq.${createdPlan.plan_id}`
        },
        (payload) => {
          console.log('[PlanBuilder] Plan execution update:', payload);
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const execution = payload.new;
            
            // Update execution status based on result
            if (execution.finished_at && execution.result) {
              if (execution.result === 'success') {
                setExecutionStatus({
                  status: 'success',
                  message: 'Registration completed successfully!',
                  result: execution.confirmation_ref
                });
                toast({
                  title: 'Registration Successful',
                  description: `Confirmation: ${execution.confirmation_ref || 'N/A'}`,
                });
              } else if (execution.result === 'failed') {
                setExecutionStatus({
                  status: 'failed',
                  message: 'Registration failed. Check execution logs for details.'
                });
                toast({
                  title: 'Registration Failed',
                  description: 'Please check the execution logs for more details.',
                  variant: 'destructive'
                });
              }
            } else if (execution.started_at && !execution.finished_at) {
              setExecutionStatus({
                status: 'running',
                message: 'Registration in progress...'
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'execution_logs',
          filter: `plan_id=eq.${createdPlan.plan_id}`
        },
        (payload) => {
          console.log('[PlanBuilder] Execution log update:', payload);
          
          const log = payload.new;
          const logMessage = (log.error_message || '').toLowerCase();
          const logMetadata = log.metadata || {};
          
          // Check for login verification status messages
          if (logMessage.includes('authenticated session verified') || 
              logMessage.includes('login verified') ||
              logMetadata.verified === true) {
            setLoginStatus('authenticated');
            setExecutionStatus({
              status: 'verified',
              message: 'Authentication verified successfully',
              verified: true
            });
            
            // Show success toast
            toast({
              title: 'Account Verified',
              description: 'Login session authenticated successfully ✅',
              className: 'bg-success text-success-foreground',
            });
          } else if (logMessage.includes('login verification failed') || 
                     logMessage.includes('login failed') ||
                     logMessage.includes('verification uncertain')) {
            setLoginStatus('action_needed');
            
            // Show warning toast for uncertain verification
            if (logMessage.includes('uncertain')) {
              toast({
                title: 'Verification Uncertain',
                description: 'Login verification is uncertain. Retrying...',
                variant: 'default',
              });
            }
          }
          
          // Check for verified authentication success
          if (log.status === 'success' && log.metadata?.verified === true) {
            setExecutionStatus({
              status: 'verified',
              message: 'Authentication verified successfully',
              verified: true
            });
          }
          
          // Handle specific error stages - only show Action Needed for real failures
          if (log.status === 'failed') {
            // Check if it's a login verification failure (not just uncertain)
            const isLoginFailure = log.stage === 'login' && 
              (log.error_message?.includes('LOGIN_VERIFICATION_FAILED') || 
               log.error_message?.includes('Login failed'));
            
            if (log.stage === 'credential_decryption' || log.stage === 'token_validation') {
              setLoginStatus('action_needed');
              setExecutionStatus({
                status: 'credential_invalid',
                message: 'Credential validation failed. Please update your credentials.'
              });
              toast({
                title: 'Invalid Credentials',
                description: 'Your stored credentials appear to be invalid. Please update them.',
                variant: 'destructive'
              });
            } else if (log.stage === 'mandate_verification') {
              setExecutionStatus({
                status: 'mandate_missing',
                message: 'Mandate not signed or missing.'
              });
              toast({
                title: 'Mandate Required',
                description: 'The required mandate is missing or not signed.',
                variant: 'destructive'
              });
            } else if (isLoginFailure) {
              // Only show Action Needed for confirmed login failures
              setLoginStatus('action_needed');
              setExecutionStatus({
                status: 'failed',
                message: 'Login verification failed. Please check your credentials.'
              });
              toast({
                title: 'Login Failed',
                description: 'Unable to verify login. Please check your credentials and try again.',
                variant: 'destructive'
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[PlanBuilder] Cleaning up realtime subscriptions');
      supabase.removeChannel(channel);
    };
  }, [createdPlan?.plan_id, toast]);

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

  // Retry handler for field discovery
  const retryDiscovery = async () => {
    const programRef = form.getValues('programRef');
    if (!programRef) {
      toast({
        title: 'Program Required',
        description: 'Please select a program first.',
        variant: 'destructive',
      });
      return;
    }
    console.log('[PlanBuilder] Retrying field discovery for:', programRef);
    await handleProgramDiscovery();
  };

  // Auto-apply smart defaults to discovered fields
  const autoApplySmartDefaults = (schema: DiscoveredSchema) => {
    const answers: Record<string, string> = {};
    const allFields = [
      ...(schema.common_questions || []),
      ...(schema.branches?.flatMap(b => b.questions) || [])
    ];

    allFields.forEach((field: any) => {
      const defaultValue = chooseDefaultAnswer(field);
      if (defaultValue) {
        answers[field.id] = defaultValue;
      }
    });

    return answers;
  };

  // Prerequisite Discovery - Stage: "prereq"
  const handleCheckPrereqs = async () => {
    const programRef = form.watch('programRef');
    const credentialId = form.watch('credentialId');
    
    if (!programRef || !credentialId) {
      toast({
        title: 'Missing Information',
        description: 'Please select a program and credentials first',
        variant: 'destructive',
      });
      return;
    }

    // Reset program data to prevent showing old results during prereq check
    setProgramQuestions([]);
    setDiscoveredSchema(null);
    setIsDiscovering(true);

    try {
      toastLogger('prereq_check', 'Checking prerequisites...', 'info', { programRef });
      
      const { data, run_id } = await mcpDiscover({
        stage: "prereq",
        program_ref: programRef,
        credential_id: credentialId,
        base_url: "https://blackhawk.skiclubpro.team",
      });

      console.log('[prereq] Poll response:', data);

      // Auto-retry if job was stale
      if (data?.status === "failed" && data?.error_message?.includes("stale")) {
        toast({
          title: "Previous run expired",
          description: "Starting a fresh discovery...",
        });
        // Retry automatically
        setTimeout(() => handleCheckPrereqs(), 500);
        return;
      }

      const blob = data || data?.result || {};
      const prereqChecks = blob.prerequisite_checks || [];
      const prereqStatus = blob.metadata?.prerequisite_status || "unknown";
      
      if (data?.status === "completed") {
        setPrerequisiteChecks(prereqChecks);
        setPrerequisiteStatus(prereqStatus);
        
        const failedFields = prereqChecks.filter((c: any) => c.status === "fail" && c.fields)
                                         .flatMap((c: any) => c.fields);
        setPrerequisiteFields(failedFields);

        toast({
          title: 'Prerequisites Complete',
          description: `${prereqChecks.length} checks evaluated`,
        });
      } else {
        // Fallback for legacy response format
        setPrerequisiteChecks(prereqChecks);
        setPrerequisiteStatus(prereqStatus);
        
        const failedFields = prereqChecks.filter((c: any) => c.status === "fail" && c.fields)
                                         .flatMap((c: any) => c.fields);
        setPrerequisiteFields(failedFields);

        if (prereqStatus === 'complete') {
          toast({
            title: 'Prerequisites Complete',
            description: 'All prerequisites are satisfied. Click "Continue to Program Questions" below.',
          });
        } else {
          toast({
            title: 'Prerequisites Required',
            description: 'Please complete the missing prerequisites before continuing.',
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      console.error('[PlanBuilder] Prereq check error:', error);
      toast({
        title: 'Prerequisite Check Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  // Program Discovery - Stage: "program" with async polling
  const handleProgramDiscovery = async () => {
    const programRef = form.watch('programRef');
    const credentialId = form.watch('credentialId');
    const childId = form.watch('childId');
    
    if (!programRef || !credentialId) {
      toast({
        title: 'Missing Information',
        description: 'Please select a program and credentials first',
        variant: 'destructive',
      });
      return;
    }

    // Clear stale state
    setProgramDiscoveryRunning(true);
    setProgramQuestions([]);
    setDiscoveredSchema(null);

    setIsDiscovering(true);

    try {
      toastLogger('program_discovery', 'Starting program discovery...', 'info', { programRef });
      
      // Start the discovery job with stage: "program"
      const { data: start, error: startError } = await supabase.functions.invoke('discover-fields-interactive', {
        body: {
          stage: 'program',
          plan_id: undefined,
          base_url: `https://blackhawk.skiclubpro.com`,
          program_id: 309, // Hardcoded for now, could be dynamic
          program_ref: programRef,
          credential_id: credentialId,
          child_name: selectedChildName || '',
          child_id: childId,
          run_mode: 'background'
        }
      });

      if (startError) throw startError;

      const jobId = start?.job_id;
      if (!jobId) throw new Error('No job ID returned');

      console.log('[Program] Discovery job started:', jobId);
      
      toast({
        title: 'Discovery Started',
        description: 'Discovering program questions... This may take 5-10 seconds.',
      });

      // Poll for job completion
      const startedAt = Date.now();
      const MAX_MS = 5 * 60 * 1000;
      let pollCount = 0;

      const poll = async () => {
        try {
          pollCount++;
          const { data: job, error: checkError } = await supabase.functions.invoke('check-discovery-job', {
            body: { job_id: jobId }
          });

          if (checkError) {
            console.error('[program] Error checking job status:', checkError);
            return;
          }

          console.log('[program] Poll response:', job);

          // Safety guard: log if still running
          if (job?.status === "running" && pollCount % 5 === 0) {
            console.log(`[program] still running... (poll ${pollCount})`);
          }

          const done = job?.status === 'completed' || job?.status === 'failed';

          const blob = job || job?.result || {};
          const programQs = blob.program_questions || [];
          const schema = blob.discovered_schema || [];

          if (done) {
            setIsDiscovering(false);

            // Auto-retry if job was stale
            if (job?.status === "failed" && job?.error_message?.includes("stale")) {
              toast({
                title: "Previous run expired",
                description: "Starting a fresh discovery...",
              });
              // Retry automatically
              setTimeout(() => handleProgramDiscovery(), 500);
              return;
            }

            if (job?.status === 'completed') {
              setProgramQuestions(programQs);
              setDiscoveredSchema(schema || {
                program_ref: programRef,
                branches: [],
                common_questions: programQs,
                discoveryCompleted: true
              });
              setProgramDiscoveryRunning(false);

              toast({
                title: 'Program Discovery Complete',
                description: `${programQs.length} questions discovered`,
              });
            } else {
              toast({
                title: 'Discovery Failed',
                description: job?.error_message || 'Unknown error occurred',
                variant: 'destructive',
              });
            }
            return;
          }

          if (Date.now() - startedAt > MAX_MS) {
            setIsDiscovering(false);
            toast({
              title: 'Discovery Timeout',
              description: 'Discovery is taking longer than expected. Please try again.',
              variant: 'destructive',
            });
            return;
          }

          setTimeout(poll, 1500);
        } catch (pollError) {
          console.error('[program] Polling error:', pollError);
        }
      };

      poll();

    } catch (error) {
      console.error('[Program] Discovery error:', error);
      setIsDiscovering(false);
      toast({
        title: 'Discovery Failed',
        description: error instanceof Error ? error.message : 'Could not discover program fields',
        variant: 'destructive',
      });
    }
  };

  // Old synchronous discovery function removed - now using handleProgramDiscovery exclusively

  const handleCheckPrerequisitesOnly = async () => {
    const programRef = form.watch('programRef');
    const credentialId = form.watch('credentialId');
    
    if (!programRef || !credentialId) {
      toast({
        title: 'Missing Information',
        description: 'Please select a program and credentials first',
        variant: 'destructive',
      });
      return;
    }

    setIsDiscovering(true);
    console.log('[Prereq] Starting prerequisite check - Program:', programRef, 'Credential:', credentialId);
    
    try {
      // Start the discovery job with stage: "prereq"
      const { data: start, error: startError } = await supabase.functions.invoke('discover-fields-interactive', {
        body: {
          stage: 'prereq',
          plan_id: undefined,
          base_url: `https://blackhawk.skiclubpro.com`,
          program_ref: programRef,
          credential_id: credentialId,
          child_id: selectedChildId || undefined,
          child_name: selectedChildName || undefined,
          run_mode: 'background'
        }
      });

      if (startError) throw startError;
      
      const jobId = start?.job_id;
      if (!jobId) {
        throw new Error('No job ID returned from discovery');
      }

      console.log('[Prereq] Job ID obtained:', jobId);
      
      toast({
        title: 'Checking Prerequisites',
        description: 'Verifying requirements... This may take 30-40 seconds.',
      });

      // Poll for job completion
      const startedAt = Date.now();
      const MAX_MS = 5 * 60 * 1000;

      const poll = async () => {
        try {
          const { data: job, error: pollError } = await supabase.functions.invoke('check-discovery-job', {
            body: { job_id: jobId }
          });

          if (pollError) {
            console.error('[Prereq] Poll error:', pollError);
            return;
          }

          const done = job?.status === 'completed' || job?.status === 'failed';

          // Prefer top-level columns, but remain compatible with older `result` shape
          const blob = job || job?.result || {};

          console.log('[Prereq] Poll response:', {
            status: job?.status,
            done,
            checks: blob.prerequisite_checks?.length,
            status_field: blob.metadata?.prerequisite_status
          });

          if (done) {
            setIsDiscovering(false);

            if (job?.status === 'completed') {
              const checks = blob.prerequisite_checks || [];
              const status = blob.metadata?.prerequisite_status || 'unknown';

              setPrerequisiteChecks(checks);
              setPrerequisiteStatus(status);

              // ALWAYS update prerequisiteFields to clear stale state
              const fieldsFromChecks = checks
                .filter((c: any) => c.status === 'fail' && c.fields)
                .flatMap((c: any) => c.fields || []);
              setPrerequisiteFields(fieldsFromChecks);

              console.log('[Prereq] Prerequisites checked:', checks);
              
              toast({
                title: 'Prerequisites Checked',
                description: `Verified ${checks.length} requirements`,
              });
            } else {
              toast({
                title: 'Check Failed',
                description: blob.error || job?.error_message || 'Unable to verify prerequisites',
                variant: 'destructive',
              });
            }
            return; // stop polling
          }

          if (Date.now() - startedAt > MAX_MS) {
            setIsDiscovering(false);
            toast({
              title: 'Check Timeout',
              description: 'Prerequisite check is taking longer than expected. Please try again.',
              variant: 'destructive',
            });
            return;
          }

          setTimeout(poll, 3000);
        } catch (pollError) {
          console.error('[Prereq] Polling error:', pollError);
        }
      };

      poll();

    } catch (error) {
      console.error('[Prereq] Error checking prerequisites:', error);
      setIsDiscovering(false);
      toast({
        title: 'Check Failed',
        description: error instanceof Error ? error.message : 'Unable to verify prerequisites',
        variant: 'destructive',
      });
    }
  };

  const handleRecheckPrereqs = async () => {
    // Use prerequisites-only discovery instead of full discovery
    await handleCheckPrerequisitesOnly();
  };

  const handleRecheckProgramQuestions = async () => {
    toastLogger('program_questions', 'Rechecking program questions…', 'info');
    
    toast({
      title: 'Refreshing Questions',
      description: 'Re-discovering program fields. This may take 5-10 seconds.',
    });
    
    // Use new stage-specific function
    await handleProgramDiscovery();
  };

  const startSignupJob = async (planId: string) => {
    if (!user || !session) {
      toast({
        title: prompts.errors.authRequired,
        description: prompts.errors.notAuthenticated,
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

  const runMVPTest = async () => {
    if (!user || !session || !createdPlan) {
      toast({
        title: 'Error',
        description: 'Missing authentication or plan data',
        variant: 'destructive',
      });
      return;
    }

    setMvpTestProgress({ inProgress: true, stage: 'checking_mandates', message: 'Checking mandates...' });
    toastLogger('mvp_test', 'Starting MVP test - full signup flow', 'info', { plan_id: createdPlan.plan_id });

    try {
      // Get credential_id from the plan
      const { data: planData, error: planError } = await supabase
        .from('plans')
        .select('*, mandates(*)')
        .eq('id', createdPlan.plan_id)
        .single();

      if (planError || !planData) {
        throw new Error('Failed to fetch plan details');
      }

      const { data: mandate } = await supabase
        .from('mandates')
        .select('*')
        .eq('id', planData.mandate_id)
        .single();

      if (!mandate) {
        throw new Error('Mandate not found');
      }

      // Get credential_id from form
      const credentialId = form.getValues('credentialId');
      if (!credentialId) {
        throw new Error('No credentials selected');
      }

      setMvpTestProgress({ inProgress: true, stage: 'discovering_fields', message: 'Discovering registration fields...' });
      toastLogger('mvp_test', 'Mandate verified, discovering fields...', 'info');

      // Get session token
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        throw new Error('No valid session');
      }

      setMvpTestProgress({ inProgress: true, stage: 'submitting_form', message: 'Submitting registration...' });
      toastLogger('mvp_test', 'Fields discovered, submitting registration...', 'info');

      // Call schedule-from-readiness edge function
      const { data, error } = await supabase.functions.invoke('schedule-from-readiness', {
        body: {
          plan_id: createdPlan.plan_id,
          credential_id: credentialId,
          user_jwt: currentSession.access_token
        }
      });

      if (error || data?.error) {
        const errorMsg = error?.message || data?.error || 'MVP test failed';
        
        // Handle specific error cases
        if (errorMsg.includes('MANDATE_MISSING')) {
          setMvpTestProgress({ 
            inProgress: false, 
            stage: 'error', 
            message: 'Mandate not signed or missing' 
          });
          toast({
            title: 'Mandate Required',
            description: 'The required mandate is missing or not signed.',
            variant: 'destructive'
          });
          return;
        }

        throw new Error(errorMsg);
      }

      setMvpTestProgress({ 
        inProgress: false, 
        stage: 'complete', 
        message: 'Registration execution started successfully' 
      });

      toastLogger('mvp_test', 'MVP test completed - execution started', 'success', { 
        execution_id: data.execution_id,
        status: data.status 
      });

      toast({
        title: 'MVP Test Started',
        description: 'The full signup flow has been initiated. Watch for realtime updates.',
      });

      console.log('MVP test response:', data);
    } catch (error) {
      console.error('Error running MVP test:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to run MVP test';
      
      toastLogger('mvp_test', errorMessage, 'error', { error });
      
      setMvpTestProgress({ 
        inProgress: false, 
        stage: 'error', 
        message: errorMessage 
      });

      toast({
        title: 'MVP Test Failed',
        description: errorMessage,
        variant: 'destructive'
      });
    }
  };

  const createMandate = async (maxCostCents: number) => {
    if (!user || !session) {
      toast({
        title: prompts.errors.authRequired,
        description: prompts.errors.notAuthenticated,
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    setIsCreatingMandate(true);
    toastLogger('mandate_creation', 'Creating mandate and plan...', 'info', { childId: form.getValues('childId') });
    
    try {
      const formData = form.getValues();
      
      // Validate required fields before proceeding
      console.log('[PlanBuilder] Form data before validation:', {
        programRef: formData.programRef,
        childId: formData.childId,
        opensAt: formData.opensAt,
        credentialId: formData.credentialId
      });

      if (!formData.programRef || !formData.childId || !formData.opensAt || !formData.credentialId) {
        const missingFields = [];
        if (!formData.programRef) missingFields.push('Program');
        if (!formData.childId) missingFields.push('Child');
        if (!formData.opensAt) missingFields.push('Registration Time');
        if (!formData.credentialId) missingFields.push('Login Credentials');
        
        toast({
          title: prompts.errors.required('Fields'),
          description: prompts.errors.missing(missingFields),
          variant: 'destructive',
        });
        return;
      }
      
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
            title: prompts.errors.authRequired,
            description: prompts.errors.sessionExpired,
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
      // Safe date handling for opens_at
      let opensAtISO: string;
      try {
        if (formData.opensAt instanceof Date && !isNaN(formData.opensAt.getTime())) {
          opensAtISO = formData.opensAt.toISOString();
        } else if (typeof formData.opensAt === 'string') {
          opensAtISO = new Date(formData.opensAt).toISOString();
        } else {
          opensAtISO = new Date().toISOString();
        }
        console.log('[PlanBuilder] Using opens_at:', opensAtISO);
      } catch (err) {
        console.warn('[PlanBuilder] Invalid opens_at, using current time:', formData.opensAt);
        opensAtISO = new Date().toISOString();
      }

      console.log('[PlanBuilder] Calling create-plan with:', {
        program_ref: formData.programRef,
        child_id: formData.childId,
        opens_at: opensAtISO,
        mandate_id: data.mandate_id
      });

      const { data: planData, error: planError } = await supabase.functions.invoke('create-plan', {
        body: {
          program_ref: formData.programRef,
          child_id: formData.childId,
          child_name: selectedChildName,
          opens_at: opensAtISO,
          mandate_id: data.mandate_id,
          provider: 'skiclubpro',
          answers: formData.answers
        }
      });

      if (planError || planData?.error) {
        const message = planError?.message || planData?.error || "Plan creation failed";
        if (message.includes('Not authenticated')) {
          toast({
            title: prompts.errors.authRequired,
            description: prompts.errors.sessionExpired,
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
      
      toastLogger('plan_creation', 'Plan created successfully', 'success', { 
        plan_id: planData.plan_id,
        mandate_id: data.mandate_id 
      });
      
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
    if (!allPassed || !selectedChildName) {
      toast({
        title: 'Prerequisites Required',
        description: 'Please ensure all prerequisites are met and a child is selected before creating the plan.',
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
  if (authLoading) {
    console.log('[PlanBuilder] Rendering loading state');
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !session) {
    console.log('[PlanBuilder] No auth - redirecting to /auth');
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
    console.log('[PlanBuilder] Rendering confirmation screen');
    
    // Status icon and color based on execution status
    const getStatusDisplay = () => {
      switch (executionStatus.status) {
        case 'success':
          return {
            icon: <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />,
            title: 'Registration Successful!',
            titleColor: 'text-success',
            badge: <Badge className="bg-success text-success-foreground">Completed</Badge>
          };
        case 'failed':
          return {
            icon: <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />,
            title: 'Registration Failed',
            titleColor: 'text-destructive',
            badge: <Badge variant="destructive">Failed</Badge>
          };
        case 'credential_invalid':
          return {
            icon: <AlertTriangle className="h-16 w-16 text-warning mx-auto mb-4" />,
            title: 'Invalid Credentials',
            titleColor: 'text-warning',
            badge: <Badge className="bg-warning text-warning-foreground">Credential Error</Badge>
          };
        case 'verified':
          return {
            icon: <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />,
            title: 'Authentication Verified',
            titleColor: 'text-success',
            badge: <Badge className="bg-success text-success-foreground">Verified</Badge>
          };
        case 'mandate_missing':
          return {
            icon: <AlertTriangle className="h-16 w-16 text-warning mx-auto mb-4" />,
            title: 'Mandate Required',
            titleColor: 'text-warning',
            badge: <Badge className="bg-warning text-warning-foreground">Mandate Missing</Badge>
          };
        case 'running':
          return {
            icon: <Loader2 className="h-16 w-16 text-primary mx-auto mb-4 animate-spin" />,
            title: 'Registration In Progress',
            titleColor: 'text-primary',
            badge: <Badge variant="secondary">Running</Badge>
          };
        default:
          return {
            icon: <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />,
            title: 'Plan Created Successfully!',
            titleColor: 'text-success',
            badge: <Badge variant="secondary">Scheduled</Badge>
          };
      }
    };

    const statusDisplay = getStatusDisplay();
    
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-8 px-4 max-w-2xl">
          <div className="text-center mb-8">
            {statusDisplay.icon}
            <h1 className={`text-3xl font-bold mb-2 ${statusDisplay.titleColor}`}>
              {statusDisplay.title}
            </h1>
            <p className="text-muted-foreground">
              {executionStatus.message || 'Your automated signup plan is ready and scheduled.'}
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
                <div className="flex justify-between items-center">
                  <span className="font-medium">Status:</span>
                  {statusDisplay.badge}
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Login Status:</span>
                  <Badge 
                    variant={
                      loginStatus === 'action_needed' ? 'destructive' :
                      loginStatus === 'authenticated' ? 'default' : 
                      'secondary'
                    }
                    className={
                      loginStatus === 'authenticated' 
                        ? 'bg-success text-success-foreground' 
                        : ''
                    }
                  >
                    {loginStatus === 'action_needed' ? (
                      <>
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Action Needed
                      </>
                    ) : loginStatus === 'authenticated' ? (
                      <>
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Authenticated
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Checking…
                      </>
                    )}
                  </Badge>
                </div>
                {executionStatus.result && (
                  <div className="flex justify-between">
                    <span className="font-medium">Confirmation:</span>
                    <span className="font-mono text-sm">{executionStatus.result}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Auto-Applied Answers Summary */}
          {discoveredSchema && form.getValues('answers') && Object.keys(form.getValues('answers') || {}).length > 0 && (
            <Card className="border-green-200 bg-green-50 dark:bg-green-950">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-900 dark:text-green-100">
                  <CheckCircle className="h-5 w-5" />
                  Smart Defaults Applied
                </CardTitle>
                <CardDescription className="text-green-700 dark:text-green-300">
                  These answers were automatically selected to secure your spot quickly
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(form.getValues('answers') || {}).map(([fieldId, value]) => {
                    const allFields = [
                      ...(discoveredSchema.common_questions || []),
                      ...(discoveredSchema.branches?.flatMap(b => b.questions) || [])
                    ];
                    const field = allFields.find((f: any) => f.id === fieldId);
                    const fieldLabel = field?.label || fieldId;
                    
                    // Display value - try to find option label or use raw value
                    let displayValue = value as string;
                    const fieldOptions = (field as any)?.options;
                    if (fieldOptions && Array.isArray(fieldOptions) && fieldOptions.length > 0) {
                      // Check if options are objects with value/label or just strings
                      const firstOpt = fieldOptions[0];
                      if (typeof firstOpt === 'object' && firstOpt.value && firstOpt.label) {
                        const option = fieldOptions.find((opt: any) => opt.value === value);
                        displayValue = option?.label || value as string;
                        
                        // Check if it's a price-bearing field and show cost
                        const priceInfo = (field as any)?.priceOptions?.find((opt: any) => opt.value === value);
                        if (priceInfo?.costCents !== undefined && priceInfo?.costCents !== null) {
                          displayValue += ` (${priceInfo.costCents === 0 ? 'Free' : `$${(priceInfo.costCents / 100).toFixed(2)}`})`;
                        }
                      }
                    }
                    
                    return (
                      <div key={fieldId} className="flex justify-between items-start p-2 rounded bg-white/50 dark:bg-black/20">
                        <span className="text-sm font-medium text-green-900 dark:text-green-100">{fieldLabel}:</span>
                        <span className="text-sm text-green-700 dark:text-green-300 text-right max-w-[60%]">
                          {displayValue}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <Alert className="mt-4 border-green-300 bg-green-100 dark:bg-green-900">
                  <AlertDescription className="text-xs text-green-800 dark:text-green-200">
                    <strong>Note:</strong> You can update these answers later by contacting the program directly after your spot is secured.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {/* MVP Test Button */}
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs">MVP Test Mode</Badge>
                    <span className="text-sm font-medium">Full Automated Flow</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Run the complete signup process: mandate check → field discovery → form submission
                  </p>
                  
                  <Button 
                    onClick={runMVPTest}
                    disabled={mvpTestProgress.inProgress}
                    className="w-full"
                    size="lg"
                    variant="default"
                  >
                    {mvpTestProgress.inProgress ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {mvpTestProgress.stage === 'checking_mandates' && 'Checking Mandates...'}
                        {mvpTestProgress.stage === 'discovering_fields' && 'Discovering Fields...'}
                        {mvpTestProgress.stage === 'submitting_form' && 'Submitting Form...'}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Run MVP Test
                      </>
                    )}
                  </Button>

                  {mvpTestProgress.message && (
                    <Alert className={mvpTestProgress.stage === 'error' ? 'border-destructive' : ''}>
                      <AlertDescription className="text-sm">
                        {mvpTestProgress.message}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>

            <Separator className="my-4" />
            
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

  const allRequirementsMet = prerequisiteChecks.length > 0 && prerequisiteChecks.every(r => r.status === 'pass') && !!selectedChildName;
  
  console.log('[PlanBuilder] Rendering main form');
  
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create Signup Plan</h1>
          <p className="text-muted-foreground">
            Follow the steps below to set up automated registration
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
            {/* Step 1: Login Credentials */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Step 1</Badge>
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="h-5 w-5" />
                      {prompts.ui.titles.signin('Blackhawk')}
                    </CardTitle>
                  </div>
                  {form.watch('credentialId') && <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
                <CardDescription>
                  Select credentials for automated login
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Step 2: Program & Child Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Step 2</Badge>
                    <CardTitle>Program & Child</CardTitle>
                  </div>
                  {form.watch('programRef') && form.watch('childId') && <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
                <CardDescription>
                  Choose the program and child to register
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="programRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Program Selection</FormLabel>
                      <FormControl>
                        <ProgramBrowser
                          onProgramSelect={({ ref, title }) => {
                            field.onChange(ref);
                            setFriendlyProgramTitle(title);
                            setDiscoveredSchema(null);
                            setSelectedBranch('');
                            setPrerequisiteChecks([]);
                            setProgramQuestions([]);
                            setActiveStep('prereqs');
                          }}
                          selectedProgram={field.value}
                          credentialId={form.watch('credentialId')}
                        />
                      </FormControl>
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
              </CardContent>
            </Card>

            {/* Step 3: Prerequisites Check */}
            {form.watch('programRef') && form.watch('childId') && form.watch('credentialId') && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 3</Badge>
                      <CardTitle>Account Prerequisites</CardTitle>
                    </div>
                    {allRequirementsMet && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
                  <CardDescription>
                    {prerequisiteChecks.length === 0 
                      ? 'Click "Check Prerequisites" to verify your account' 
                      : 'System verification complete'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Step Indicator */}
                  {prerequisiteChecks.length > 0 && (
                    <div className="mb-6">
                      <StepIndicator
                        currentStep={
                          activeStep === 'prereqs' ? 1 : 
                          activeStep === 'program' ? 2 : 
                          3
                        }
                        totalSteps={3}
                        stepLabels={['Prerequisites', 'Program Questions', 'Complete']}
                      />
                    </div>
                  )}
                  {/* Phase 2.5: Green Light / Yellow Light UI */}
                  {prerequisiteStatus === 'complete' && prerequisiteFields.length === 0 ? (
                    <Card className="border-green-200 bg-green-50">
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <CardTitle className="text-green-900">Prerequisites Complete</CardTitle>
                        </div>
                        <CardDescription className="text-green-700">
                          All prerequisites are met. You can proceed directly to program registration!
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button
                          onClick={handleProgramDiscovery}
                          disabled={isDiscovering || programDiscoveryRunning}
                          className="w-full"
                        >
                          {isDiscovering || programDiscoveryRunning ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Discovering...
                            </>
                          ) : (
                            'Continue to Program Questions'
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  ) : prerequisiteStatus === 'required' && prerequisiteFields.length > 0 ? (
                    <Card className="border-yellow-200 bg-yellow-50">
                      <CardHeader>
                        <CardTitle className="text-yellow-900">Before You Begin</CardTitle>
                        <CardDescription className="text-yellow-700">
                          Please complete these prerequisites:
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                       <PrerequisitesPanel
                         key={prerequisiteChecks.length}
                         checks={prerequisiteChecks}
                         onRecheck={handleCheckPrerequisitesOnly}
                         onContinue={() => setActiveStep('program')}
                       />
                      </CardContent>
                    </Card>
                  ) : prerequisiteChecks.length === 0 ? (
                    <div className="space-y-4">
                      <Alert>
                        <Shield className="h-4 w-4" />
                        <AlertDescription>
                          Before proceeding, we'll verify your account status, membership, and payment method.
                        </AlertDescription>
                      </Alert>
                      <Button
                        onClick={handleRecheckPrereqs}
                        disabled={isDiscovering}
                        className="w-full"
                      >
                        {isDiscovering ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Checking Prerequisites...
                          </>
                        ) : (
                          <>
                            <Shield className="h-4 w-4" />
                            Check Prerequisites
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <AnimatePresence mode="wait">
                        {activeStep === 'prereqs' ? (
                        <PrerequisitesPanel
                          key={`prereqs-${prerequisiteChecks.length}-${Date.now()}`}
                          checks={prerequisiteChecks}
                          metadata={discoveryMetadata}
                          onRecheck={handleCheckPrerequisitesOnly}
                          onContinue={async () => {
                            const childId = form.watch('childId');
                            const programRef = form.watch('programRef');
                            const openTime = form.watch('opensAt');
                            
                            // Validate all required fields
                            if (!childId || !programRef) {
                              toast({
                                title: 'Missing Information',
                                description: 'Please select both a child and program',
                                variant: 'destructive',
                              });
                              return;
                            }

                            if (!openTime) {
                              toast({
                                title: 'Missing Registration Time',
                                description: 'Please set when registration opens (Step 4)',
                                variant: 'destructive',
                              });
                              return;
                            }

                            // Get child name
                            const { data: childData, error: childError } = await supabase
                              .from('children')
                              .select('name')
                              .eq('id', childId)
                              .maybeSingle();
                            
                            if (childError || !childData) {
                              toast({
                                title: 'Error',
                                description: 'Could not load child information',
                                variant: 'destructive',
                              });
                              return;
                            }

                            setSelectedChildName(childData.name);
                            
                            // Move to program questions if available, otherwise proceed to discovery
                            if (programQuestions.length > 0) {
                              setActiveStep('program');
                              toast({
                                title: 'Prerequisites Verified',
                                description: 'Please answer the program-specific questions below.',
                              });
                            } else {
                              // Show loading toast for auto-discovery
                              toast({
                                title: 'Discovering Program Questions...',
                                description: 'This may take 5-10 seconds.',
                              });

                              // Use MCP background job for discovery
                              await handleProgramDiscovery();
                            }
                          }}
                        />
                        ) : activeStep === 'program' ? (
                        <ProgramQuestionsPanel
                          key={programQuestions.length}
                          questions={programQuestions}
                          initialAnswers={form.watch('answers') || {}}
                          onSubmit={(answers) => {
                            console.log('[PlanBuilder] Program questions submitted:', answers);
                            form.setValue('answers', answers as any);
                            
                            toast({
                              title: 'Answers Saved',
                              description: 'Your program-specific answers have been recorded.',
                            });
                            
                            toastLogger('program_questions', 'Answers saved successfully', 'success', { 
                              answerCount: Object.keys(answers).length 
                            });

                            // Move to completion screen
                            setActiveStep('completed');
                          }}
                          onBack={() => {
                            setActiveStep('prereqs');
                            toast({
                              title: 'Returned to Prerequisites',
                              description: 'You can review or recheck prerequisites.',
                            });
                          }}
                          onRecheck={handleRecheckProgramQuestions}
                          isSubmitting={false}
                          isRechecking={isDiscovering}
                        />
                      ) : (
                        <CompletionPanel
                          key="completed"
                          onFinish={() => {
                            navigate('/');
                          }}
                        />
                      )}
                      </AnimatePresence>
                      
                      {/* Discovery Coverage Details */}
                      {discoveryMetadata && (
                        <DiscoveryCoverage metadata={discoveryMetadata} />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Loading state for auto-discovery - only show during discovery */}
            {allRequirementsMet && opensAt && isDiscovering && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Step 5</Badge>
                    <CardTitle>Securing Your Spot</CardTitle>
                  </div>
                  <CardDescription>
                    Applying smart defaults to reserve your spot quickly
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-blue-900">
                          Loading program questions and applying defaults...
                        </p>
                        <p className="text-xs text-blue-700">
                          We're using smart defaults to secure your spot. You can review and update answers after registration.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 5: Registration Form Fields */}
            {/* Show loading state while discovery is running */}
            {programDiscoveryRunning && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Step 5</Badge>
                    <CardTitle>Discovering Program Questions</CardTitle>
                  </div>
                  <CardDescription>
                    Please wait while we discover the registration form fields...
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground">
                    <Loader2 className="animate-spin inline mr-2 h-5 w-5" />
                    Discovering program questions… This may take 15-30 seconds.
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Show results after discovery completes */}
            {discoveredSchema && !programDiscoveryRunning && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 5</Badge>
                      <CardTitle>Program Questions</CardTitle>
                    </div>
                    {discoveredSchema.discoveryCompleted && programQuestions.length > 0 && (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    )}
                  </div>
                  <CardDescription>
                    {discoveredSchema.discoveryCompleted 
                      ? programQuestions.length > 0
                        ? `${programQuestions.length} question${programQuestions.length === 1 ? '' : 's'} to answer`
                        : 'No additional questions required for this program'
                      : 'Click "Continue to Program Questions" to discover fields'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Handle case where discovery ran and no questions were found */}
                  {discoveredSchema.discoveryCompleted && programQuestions.length === 0 ? (
                    <div className="space-y-4">
                      <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-start gap-3">
                          <div className="bg-green-100 p-2 rounded-full">
                            <CheckCircle className="h-5 w-5 text-green-700" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-semibold text-green-900 mb-2">
                              No Additional Questions Required
                            </h3>
                            <p className="text-sm text-green-800 mb-3">
                              Good news! This program doesn't require any additional information beyond what we've already collected.
                              You can proceed directly to setting up your registration timing.
                            </p>
                            <div className="text-xs text-green-700 bg-green-100 p-3 rounded border border-green-200">
                              <p className="font-medium mb-1">What we checked:</p>
                              <ul className="list-disc list-inside space-y-1">
                                <li>Registration form fields</li>
                                <li>Program-specific options</li>
                                <li>Additional preferences</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          onClick={retryDiscovery}
                          variant="outline"
                          size="sm"
                          disabled={isDiscovering}
                        >
                          {isDiscovering ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Rechecking...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Recheck
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => window.open(`https://blackhawk-ski-club.skiclubpro.team/program/${form.getValues('programRef')}`, '_blank')}
                          variant="outline"
                          size="sm"
                        >
                          View Program Page
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Branch Selection */}
                      {discoveredSchema.branches && discoveredSchema.branches.length > 1 && (
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Program Options</label>
                          <p className="text-xs text-muted-foreground mb-2">
                            This program has multiple sessions or tracks. Select the one you want to register for:
                          </p>
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

                      {/* Auto-select if only one branch */}
                      {discoveredSchema.branches && discoveredSchema.branches.length === 1 && !selectedBranch && (
                        <div className="hidden">
                          {(() => {
                            setSelectedBranch(discoveredSchema.branches[0].choice);
                            return null;
                          })()}
                        </div>
                      )}

                      {/* Render program questions if available */}
                      {programDiscoveryRunning ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Loader2 className="animate-spin inline mr-2 h-6 w-6" />
                          <p className="mt-2">Discovering program questions…</p>
                        </div>
                      ) : programQuestions.length > 0 ? (
                        <div className="space-y-6">
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-xs text-blue-800">
                              <strong>Tip:</strong> Fill out all required fields marked with an asterisk (*).
                              Your answers will be automatically provided during registration.
                            </p>
                          </div>
                          
                          {programQuestions.map((question) => (
                            <FormField
                              key={question.id}
                              control={form.control}
                              name={`answers.${question.id}`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {question.label}
                                    {question.required && <span className="text-red-500 ml-1">*</span>}
                                  </FormLabel>
                                  <FormControl>
                                    {question.type === 'select' ? (
                                      <Select
                                        value={field.value as string}
                                        onValueChange={field.onChange}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder={`Select ${question.label}`} />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {question.options?.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                              {option.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : question.type === 'checkbox' ? (
                                      <div className="space-y-2">
                                        {question.options?.map((option) => {
                                          const currentValue = field.value;
                                          const isArray = Array.isArray(currentValue);
                                          const checked = isArray && currentValue.includes(option.value);
                                          
                                          return (
                                            <div key={option.value} className="flex items-center space-x-2">
                                              <Checkbox
                                                id={`${question.id}-${option.value}`}
                                                checked={checked}
                                                onCheckedChange={(isChecked) => {
                                                  const current = isArray ? currentValue : [];
                                                  if (isChecked) {
                                                    field.onChange([...current, option.value]);
                                                  } else {
                                                    field.onChange(current.filter((v: string) => v !== option.value));
                                                  }
                                                }}
                                              />
                                              <Label htmlFor={`${question.id}-${option.value}`}>{option.label}</Label>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <Input
                                        value={typeof field.value === 'string' ? field.value : ''}
                                        onChange={field.onChange}
                                        type="text"
                                        placeholder={`Enter ${question.label}`}
                                      />
                                    )}
                                  </FormControl>
                                  {question.description && (
                                    <FormDescription>{question.description}</FormDescription>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                      ) : Object.entries(fieldsByCategory).length > 0 ? (
                        <div className="space-y-6">
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-xs text-blue-800">
                              <strong>Tip:</strong> Fill out all required fields marked with an asterisk (*).
                              Your answers will be automatically provided during registration.
                            </p>
                          </div>
                          
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
                        </div>
                      ) : (
                        <Card className="bg-green-50 border-green-200">
                          <CardHeader>
                            <CardTitle>No Additional Questions Required</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p>Good news! This program doesn't require any additional information beyond what we've already collected.</p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 4: Registration Timing - Show BEFORE discovery */}
            {allRequirementsMet && !discoveredSchema && !isDiscovering && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 4</Badge>
                      <CardTitle>{prompts.ui.titles.openTime}</CardTitle>
                    </div>
                    {opensAt && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
                  <CardDescription>
                    When should automated registration begin?
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                          Set the exact date and time when registration opens
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 6: Payment Limit */}
            {discoveredSchema && opensAt && !showMandateSummary && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 6</Badge>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5" />
                        {prompts.ui.titles.limit}
                      </CardTitle>
                    </div>
                    {form.watch('maxAmountCents') > 0 && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
                  <CardDescription>
                    {prompts.ui.limit.helper}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="maxAmountCents"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{prompts.ui.limit.label}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              type="number"
                              placeholder="175.00"
                              className="pl-7"
                              value={field.value ? (field.value / 100).toFixed(2) : ''}
                              onChange={(e) => {
                                const dollars = parseFloat(e.target.value) || 0;
                                field.onChange(Math.round(dollars * 100));
                              }}
                            />
                          </div>
                        </FormControl>
                        {detectedPriceCents && (
                          <div className="text-sm space-y-1 p-3 bg-muted rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Detected program cost:</span>
                              <span className="font-medium">{fmt.money(detectedPriceCents)}</span>
                            </div>
                            {field.value > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Your cap:</span>
                                <span className="font-medium">{fmt.money(field.value)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 8: How We'll Handle Extra Questions */}
            {discoveredSchema && opensAt && form.watch('maxAmountCents') > 0 && !showMandateSummary && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Step 8</Badge>
                    <CardTitle>{prompts.ui.defaults.headline}</CardTitle>
                  </div>
                  <CardDescription>
                    {prompts.ui.defaults.explainer}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Rules we'll follow:</h4>
                    <ul className="space-y-2">
                      {prompts.ui.defaults.rules.map((rule, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-sm">
                          <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-muted-foreground">{rule}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 9: Contact Information */}
            {discoveredSchema && opensAt && form.watch('maxAmountCents') > 0 && !showMandateSummary && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 9</Badge>
                      <CardTitle>{prompts.ui.titles.contact}</CardTitle>
                    </div>
                    {form.watch('contactPhone') && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
                  <CardDescription>
                    {prompts.ui.contact.helper}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{prompts.ui.contact.label}</FormLabel>
                        <FormControl>
                          <Input
                            type="tel"
                            placeholder={prompts.ui.contact.ph}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Step 10: Payment Method */}
            {discoveredSchema && opensAt && form.watch('maxAmountCents') > 0 && form.watch('contactPhone') && !showMandateSummary && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">Step 10</Badge>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5" />
                        Payment Method
                      </CardTitle>
                    </div>
                    {hasPaymentMethod && <CheckCircle className="h-5 w-5 text-green-600" />}
                  </div>
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

            {/* Step 11: Mandate Summary & Finalize */}
            {discoveredSchema && opensAt && hasPaymentMethod && allRequirementsMet && form.watch('maxAmountCents') > 0 && form.watch('contactPhone') && showMandateSummary && !showConfirmation && (
              <MandateSummary
                orgRef="blackhawk-ski-club"
                programTitle={friendlyProgramTitle || form.watch('programRef')}
                programRef={form.watch('programRef')}
                credentialId={form.watch('credentialId')}
                childName={selectedChildName}
                answers={form.watch('answers') || {}}
                detectedPriceCents={detectedPriceCents}
                caps={{
                  max_provider_charge_cents: form.watch('maxAmountCents'),
                  service_fee_cents: caps.service_fee_cents
                }}
                openTimeISO={opensAt instanceof Date ? opensAt.toISOString() : new Date(opensAt).toISOString()}
                preferredSlot={selectedBranch || 'Standard Registration'}
                onCreated={(planId, mandateId) => {
                  setCreatedPlan({ plan_id: planId, mandate_id: mandateId });
                  setShowConfirmation(true);
                  setShowMandateSummary(false);
                }}
              />
            )}

            {/* Step 12: Plan Created - Show Execution Status */}
            {showConfirmation && createdPlan && (
              <PlanExecutionStatus
                planId={createdPlan.plan_id}
                mandateId={createdPlan.mandate_id}
                programTitle={friendlyProgramTitle || form.watch('programRef')}
                childName={selectedChildName}
                opensAt={opensAt instanceof Date ? opensAt.toISOString() : new Date(opensAt).toISOString()}
                maxAmountCents={form.watch('maxAmountCents')}
              />
            )}

            {/* Plan Preview */}
            {discoveredSchema && allFields.length > 0 && opensAt && hasPaymentMethod && (
              <PlanPreview
                programRef={friendlyProgramTitle || form.watch('programRef')}
                childName="Selected Child"
                opensAt={(() => {
                  try {
                    let dateValue: Date;
                    if (opensAt instanceof Date && !isNaN(opensAt.getTime())) {
                      dateValue = opensAt;
                    } else if (typeof opensAt === 'string') {
                      dateValue = new Date(opensAt);
                      if (isNaN(dateValue.getTime())) {
                        throw new Error('Invalid date string');
                      }
                    } else {
                      throw new Error('Invalid date format');
                    }
                    return dateValue;
                  } catch (error) {
                    console.error('[PlanBuilder] Error parsing opensAt:', error);
                    return new Date();
                  }
                })()}
                selectedBranch={selectedBranch}
                answers={form.watch('answers') || {}}
                discoveredFields={allFields}
                credentialAlias="Login Credentials"
              />
            )}

            {/* Action Buttons */}
            {!showMandateSummary && !showConfirmation && discoveredSchema && opensAt && hasPaymentMethod && form.watch('maxAmountCents') > 0 && form.watch('contactPhone') && (
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
                  type="button"
                  disabled={!allRequirementsMet}
                  className="flex-1"
                  onClick={() => setShowMandateSummary(true)}
                >
                  {prompts.ui.cta.createMandate}
                </Button>
              </div>
            )}
            
            {showMandateSummary && !showConfirmation && (
              <div className="flex gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowMandateSummary(false)}
                  className="flex-1"
                >
                  Back to Form
                </Button>
              </div>
            )}
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
    <ErrorBoundary>
      <Elements stripe={stripePromise}>
        <PlanBuilder />
      </Elements>
    </ErrorBoundary>
  );
}