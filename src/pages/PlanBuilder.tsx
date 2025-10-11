import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { ProgramQuestionsAutoAnswered } from '@/components/ProgramQuestionsAutoAnswered';
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
import { LockedStepPreview } from '@/components/LockedStepPreview';
import { ProgressIndicator } from '@/components/ProgressIndicator';

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
  prereqComplete: z.boolean().optional(),
  mandate: z.object({
    login: z.boolean().optional(),
    fill: z.boolean().optional(),
    questions: z.boolean().optional(),
    payUpTo: z.boolean().optional(),
    pause: z.boolean().optional(),
    audit: z.boolean().optional(),
  }).optional(),
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
      prereqComplete: false,
      mandate: { login: false, fill: false, questions: false, payUpTo: false, pause: false, audit: false },
    },
  });

  const { user, session, loading: authLoading, isSessionValid } = useAuth();
  // V1: Removed discoveredSchema, programQuestions, programDiscoveryRunning - no program discovery in v1
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
  const [activeStep, setActiveStep] = useState<'prereqs' | 'program' | 'completed'>('prereqs');
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [friendlyProgramTitle, setFriendlyProgramTitle] = useState<string | null>(null);
  const [selectedChildName, setSelectedChildName] = useState<string>('');
  
  // Watch prereqComplete outside useMemo for proper reactivity
  const prereqComplete = form.watch('prereqComplete');
  
  // Compute allRequirementsMet once to avoid re-calculation in multiple places
  const allRequirementsMet = useMemo(() => {
    console.log('[PlanBuilder] allRequirementsMet check:', {
      prereqComplete,
      prerequisiteChecks,
      checksLength: prerequisiteChecks.length,
      checksPassing: prerequisiteChecks.length > 0 ? prerequisiteChecks.every(r => r.status === 'pass') : 'N/A'
    });
    
    // If form explicitly marks prereqs complete, honor that
    if (prereqComplete === true) {
      console.log('[PlanBuilder] ✅ Prerequisites marked complete via form field');
      return true;
    }
    
    // Otherwise check the prerequisiteChecks array
    const result = prerequisiteChecks.length === 0 || prerequisiteChecks.every(r => r.status === 'pass');
    console.log('[PlanBuilder] Prerequisites check result:', result);
    return result;
  }, [prerequisiteChecks, prereqComplete]);
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
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  const [loginCheckTimeout, setLoginCheckTimeout] = useState<NodeJS.Timeout | null>(null);
  
  // Refs for auto-scroll functionality - one for each step
  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const step5Ref = useRef<HTMLDivElement>(null);
  const step6Ref = useRef<HTMLDivElement>(null);
  const step7Ref = useRef<HTMLDivElement>(null);
  const [shouldHighlightStep, setShouldHighlightStep] = useState<number | null>(null);

  // Phone validation utility
  const isValidPhone = useCallback((value?: string) => {
    if (!value) return false;
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }, []);

  // Safe derived variables with null checks and defaults
  // V1: No program discovery, so no fieldsToShow
  const selectedChildId = form.watch('childId') ?? '';
  const opensAt = form.watch('opensAt') ?? null;
  const maxAmountCents = form.watch('maxAmountCents') ?? 0;
  const contactPhone = form.watch('contactPhone') ?? '';
  // prereqComplete is watched earlier (line 153) for allRequirementsMet reactivity

  // Watch mandate consent checkboxes
  const mandateFlags = form.watch([
    'mandate.login',
    'mandate.fill',
    'mandate.questions',
    'mandate.payUpTo',
    'mandate.pause',
    'mandate.audit',
  ] as const) as boolean[] | undefined;

  const opensAtVal = form.watch('opensAt');
  const maxAmountCentsVal = form.watch('maxAmountCents');
  const contactPhoneVal = form.watch('contactPhone');

  const opensAtTruthy = opensAtVal instanceof Date && !Number.isNaN(opensAtVal.getTime());
  const contactPhoneValid = isValidPhone(contactPhoneVal);
  const allMandateChecked = Array.isArray(mandateFlags) && mandateFlags.length === 6 && mandateFlags.every(Boolean);

  // --- values MandateSummary and create-plan need ---
  const childId = form.watch('childId') || selectedChildId || '';
  const programRef = (form.watch('programRef') as string) || '';
  
  // --- load credential id from stored credentials or form state ---
  const credentialId = (form.watch('credentialId') as string) || '';
  const openTimeISO =
    opensAtVal instanceof Date && !Number.isNaN(opensAtVal.getTime())
      ? opensAtVal.toISOString()
      : '';

  // Compute if "Create Mandate" button should show (independent of prerequisites)
  const canShowMandateButton = useMemo(() => {
    const isValid = 
      !!hasPaymentMethod &&
      opensAtTruthy &&
      (maxAmountCents || 0) > 0 &&
      (contactPhone || '').length >= 10;
    
    console.log('[PlanBuilder] canShowMandateButton:', {
      hasPaymentMethod,
      opensAtValid: opensAtTruthy,
      maxAmountCents,
      contactPhoneLength: (contactPhone || '').length,
      result: isValid
    });
    
    return isValid;
  }, [hasPaymentMethod, opensAtTruthy, maxAmountCents, contactPhone]);

  // Compute if "Sign & Create Plan" button should be enabled (inside MandateSummary)
  const canCreatePlan = useMemo(() => {
    const childNameVal = form.watch('childId');
    const programRefVal = form.watch('programRef');
    const credentialIdVal = form.watch('credentialId');
    
    const ok =
      !!hasPaymentMethod &&
      !!opensAtTruthy &&
      (Number(maxAmountCentsVal) || 0) > 0 &&
      !!contactPhoneValid &&
      !!allMandateChecked &&
      !!childNameVal &&
      !!programRefVal &&
      !!credentialIdVal &&
      !!opensAtVal;

    return ok;
  }, [hasPaymentMethod, opensAtTruthy, maxAmountCentsVal, contactPhoneValid, allMandateChecked, form]);

  // Timeout for login verification - prevent infinite "Checking..." state
  useEffect(() => {
    if (mvpTestProgress.inProgress && loginStatus === 'checking') {
      console.log('[PlanBuilder] Setting 45-second timeout for login verification');
      
      // Set 45-second timeout for login verification
      const timeout = setTimeout(() => {
        console.warn('[PlanBuilder] Login verification timeout - no logs received');
        setLoginStatus('action_needed');
        toast({
          title: 'Verification Timeout',
          description: 'Login verification is taking longer than expected. Please check the logs.',
          variant: 'default'
        });
      }, 45000); // 45 seconds
      
      setLoginCheckTimeout(timeout);
      
      // Cleanup on unmount or when status changes
      return () => {
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    } else if (loginStatus !== 'checking' && loginCheckTimeout) {
      // Clear timeout if status changes
      console.log('[PlanBuilder] Clearing login verification timeout - status changed to', loginStatus);
      clearTimeout(loginCheckTimeout);
      setLoginCheckTimeout(null);
    }
  }, [mvpTestProgress.inProgress, loginStatus, loginCheckTimeout, toast]);

  // Debug logging for "Sign & Create Plan" button
  useEffect(() => {
    const childNameVal = form.watch('childId');
    const programRefVal = form.watch('programRef');
    const credentialIdVal = form.watch('credentialId');
    
    const reasons: string[] = [];
    if (!hasPaymentMethod) reasons.push('no payment method');
    if (!opensAtTruthy) reasons.push('opensAt invalid');
    if (!maxAmountCentsVal || Number(maxAmountCentsVal) <= 0) reasons.push('maxAmountCents <= 0');
    if (!contactPhoneValid) reasons.push('invalid phone');
    if (!allMandateChecked) reasons.push('mandate checkboxes not all checked');
    if (!childNameVal) reasons.push('childId missing');
    if (!programRefVal) reasons.push('programRef missing');
    if (!credentialIdVal) reasons.push('credentialId missing');
    if (!opensAtVal) reasons.push('opensAtVal missing');

    console.log('[MandateButton] gate', {
      hasPaymentMethod,
      opensAtTruthy,
      maxAmountCents: maxAmountCentsVal,
      contactPhoneValid,
      allMandateChecked,
      childId: childNameVal,
      programRef: programRefVal,
      credentialId: credentialIdVal,
      opensAtVal: opensAtVal,
      enabled: reasons.length === 0,
      reasons,
    });
  }, [hasPaymentMethod, opensAtTruthy, maxAmountCentsVal, contactPhoneValid, allMandateChecked, form, opensAtVal]);

  // Debug logging for step unlock state
  console.log('[PlanBuilder] Step unlock state:', {
    opensAt: opensAt,
    opensAtType: typeof opensAt,
    opensAtIsDate: opensAt instanceof Date,
    maxAmountCents,
    contactPhone,
    hasPaymentMethod,
    step6Unlocked: opensAt && maxAmountCents > 0,
    step7Unlocked: opensAt && maxAmountCents > 0 && !!contactPhone,
    mandateButtonVisible: opensAt && hasPaymentMethod && maxAmountCents > 0 && !!contactPhone,
    mandateButtonEnabled: allRequirementsMet,
    allRequirementsMet,
    selectedChildName,
  });

  // Debug logging - only runs on mount to avoid re-render loops
  useEffect(() => {
    console.log('[PlanBuilder] 🔄 Initial form state:', {
      opensAt,
      opensAtType: typeof opensAt,
      opensAtIsDate: opensAt instanceof Date,
      opensAtIsValid: opensAt && !isNaN(new Date(opensAt).getTime()),
      maxAmountCents,
      contactPhone,
      prereqComplete,
      hasPaymentMethod,
      showMandateSummary,
    });
  }, []); // Only run once on mount

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Debug: Track what's causing re-renders
  useEffect(() => {
    console.log('[PlanBuilder] 🔄 RENDER TRIGGER:', {
      timestamp: new Date().toISOString(),
      authLoading,
      hasPaymentMethod,
      reloadTrigger,
      user: !!user,
      session: !!session,
    });
  });

  // Define checkPaymentMethod early so it can be used in useEffects below
  const checkPaymentMethod = useCallback(async () => {
    if (!user) return;
    
    setCheckingPayment(true);
    try {
    const { data, error } = await supabase
      .from('user_billing')
      .select('default_payment_method_id')
      .eq('user_id', user.id)
      .maybeSingle();

      if (error) {
        throw error;
      }

      setHasPaymentMethod(!!data?.default_payment_method_id);
    } catch (error) {
      console.error('Error checking payment method:', error);
    } finally {
      setCheckingPayment(false);
    }
  }, [user]);

  const handlePaymentMethodSaved = useCallback(async () => {
    console.log('[PlanBuilder] 💳 ========== PAYMENT METHOD SAVED ==========');
    console.log('[PlanBuilder] 📊 State BEFORE reload:', {
      opensAt: form.getValues('opensAt'),
      opensAtType: typeof form.getValues('opensAt'),
      maxAmountCents: form.getValues('maxAmountCents'),
      contactPhone: form.getValues('contactPhone'),
      prereqComplete: form.getValues('prereqComplete'),
    });
    
    // Optimistic unlock - UI updates immediately
    setHasPaymentMethod(true);
    
    // Verify with DB for page refreshes
    await checkPaymentMethod();
    
    console.log('[PlanBuilder] 🔄 Triggering DraftSaver reload...');
    const reloadTimestamp = Date.now();
    setReloadTrigger(reloadTimestamp);
    
    console.log('[PlanBuilder] ⏰ Reload triggered with timestamp:', reloadTimestamp);
    
    // Wait a tick for reload to complete
    setTimeout(() => {
      console.log('[PlanBuilder] 📊 State AFTER reload:', {
        opensAt: form.getValues('opensAt'),
        opensAtType: typeof form.getValues('opensAt'),
        opensAtIsDate: form.getValues('opensAt') instanceof Date,
        maxAmountCents: form.getValues('maxAmountCents'),
        contactPhone: form.getValues('contactPhone'),
        prereqComplete: form.getValues('prereqComplete'),
      });
      console.log('[PlanBuilder] ========================================');
    }, 100);
  }, [checkPaymentMethod, form]);


  // Redirect to auth if not authenticated or session invalid
  useEffect(() => {
    // Add a small delay to prevent redirects during session refresh
    const validationTimer = setTimeout(() => {
      if (!authLoading) {
        if (!user) {
          console.warn('[PlanBuilder] No user, redirecting to auth');
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
    }, 500); // 500ms debounce to allow session refresh to complete

    return () => clearTimeout(validationTimer);
  }, [user, authLoading, navigate, isSessionValid, toast]);

  // Check for payment method
  useEffect(() => {
    if (user) {
      checkPaymentMethod();
    }
  }, [user, checkPaymentMethod]);

  // Auto-fetch child name when childId changes
  useEffect(() => {
    const fetchChildName = async () => {
      const childId = form.watch('childId');
      if (childId && !selectedChildName) {
        const { data: childData, error } = await supabase
          .from('children')
          .select('name')
          .eq('id', childId)
          .maybeSingle();
        
        if (!error && childData) {
          setSelectedChildName(childData.name);
        }
      }
    };
    
    fetchChildName();
  }, [form.watch('childId'), selectedChildName]);

  // DISABLED: Auto-scroll interferes with form submission
  // const scrollToStep = useCallback((stepNumber: number, ref: React.RefObject<HTMLDivElement>) => {
  //   if (ref.current && shouldHighlightStep !== stepNumber) {
  //     setTimeout(() => {
  //       if (ref.current) {
  //         ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  //         setShouldHighlightStep(stepNumber);
  //         
  //         setTimeout(() => {
  //           setShouldHighlightStep(null);
  //         }, 3000);
  //       }
  //     }, 300);
  //   }
  // }, [shouldHighlightStep]);

  // Auto-scroll when steps unlock - DISABLED to prevent page jumpiness
  // TODO: Re-enable with one-time scroll logic if desired
  // useEffect(() => {
  //   if (allRequirementsMet && !isDiscovering) {
  //     scrollToStep(4, step4Ref);
  //   }
  // }, [allRequirementsMet, isDiscovering, scrollToStep]);

  // useEffect(() => {
  //   if (opensAt) {
  //     scrollToStep(5, step5Ref);
  //   }
  // }, [opensAt, scrollToStep]);

  // useEffect(() => {
  //   if (maxAmountCents > 0) {
  //     scrollToStep(6, step6Ref);
  //   }
  // }, [maxAmountCents, scrollToStep]);

  // useEffect(() => {
  //   if (contactPhone && contactPhone.length >= 10) {
  //     scrollToStep(7, step7Ref);
  //   }
  // }, [contactPhone, scrollToStep]);

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

  // Moved up - this function is now defined earlier in the component

  // Helper function for showing function errors
  const showFunctionError = (error: any, action: string) => {
    const message = error?.message || `${action} failed. Please try again.`;
    toast({
      title: `${action} Failed`,
      description: message,
      variant: 'destructive',
    });
  };

  // V1: No manual retry needed - program questions handled at execution time

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

  // V1: Program questions are handled automatically at execution time
  // Discovery logic removed - no need to discover questions in UI

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
              let status = blob.metadata?.prerequisite_status || 'unknown';

              // ✅ Client-side defensive override: If all checks passed, force status='complete'
              const allChecksPassed = checks.length === 0 || checks.every((c: any) => c.status === 'pass');
              if (allChecksPassed && status !== 'complete') {
                console.log('[Prereq] 🛡️ Defensive override: All checks passed, forcing status=complete');
                status = 'complete';
              }

              setPrerequisiteChecks(checks);
              setPrerequisiteStatus(status);

              // ALWAYS update prerequisiteFields to clear stale state
              const fieldsFromChecks = checks
                .filter((c: any) => c.status === 'fail' && c.fields)
                .flatMap((c: any) => c.fields || []);
              setPrerequisiteFields(fieldsFromChecks);

              // ✅ Mark prerequisites complete if all checks pass
              if (allChecksPassed) {
                form.setValue('prereqComplete', true);
                console.log('[Prereq] Marking prerequisites complete');
              }

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

  // V1: No recheck needed - program questions handled at execution time

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
      const payload = {
        plan_id: createdPlan.plan_id,
        credential_id: credentialId,
        user_jwt: currentSession.access_token,
        opensAtValue: opensAt instanceof Date ? opensAt.toISOString() : opensAt
      };
      console.log('[Frontend] calling schedule-from-readiness with payload', payload);
      const { data, error } = await supabase.functions.invoke('schedule-from-readiness', {
        body: payload
      });
      if (error) console.error('[Frontend] schedule-from-readiness error', error);
      else console.log('[Frontend] schedule-from-readiness response', data);

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
      
      // Reset login status on failure
      setLoginStatus('action_needed');
      
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

          {/* V1: Auto-applied answers summary removed - no program discovery */}

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

  // Prerequisites met: calculated once via useMemo above
  
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

        {/* Progress Indicator - Always visible */}
        <ProgressIndicator
          currentStep={
            hasPaymentMethod && form.watch('contactPhone') && form.watch('maxAmountCents') > 0 && opensAt ? 7 :
            form.watch('contactPhone') && form.watch('maxAmountCents') > 0 && opensAt ? 6 :
            form.watch('maxAmountCents') > 0 && opensAt ? 5 :
            opensAt ? 4 :
            allRequirementsMet ? 3 :
            form.watch('programRef') && form.watch('childId') && form.watch('credentialId') ? 2 :
            form.watch('credentialId') ? 1 :
            0
          }
          totalSteps={7}
          stepLabels={[
            'Login',
            'Program',
            'Prerequisites',
            'Timing',
            'Limit',
            'Contact',
            'Payment'
          ]}
          completedSteps={[
            ...(form.watch('credentialId') ? [1] : []),
            ...(form.watch('programRef') && form.watch('childId') ? [2] : []),
            ...(allRequirementsMet ? [3] : []),
            ...(opensAt ? [4] : []),
            ...(form.watch('maxAmountCents') > 0 ? [5] : []),
            ...(form.watch('contactPhone') && form.watch('contactPhone').length >= 10 ? [6] : []),
            ...(hasPaymentMethod ? [7] : []),
          ]}
          lockedSteps={[
            ...(!form.watch('credentialId') ? [2] : []),
            ...(!form.watch('programRef') || !form.watch('childId') || !form.watch('credentialId') ? [3] : []),
            ...(!allRequirementsMet ? [4] : []),
            ...(!opensAt ? [5, 6, 7] : []),
            ...(!form.watch('maxAmountCents') || form.watch('maxAmountCents') === 0 ? [6, 7] : []),
            ...(!form.watch('contactPhone') || form.watch('contactPhone').length < 10 ? [7] : []),
          ]}
        />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Step 1: Login Credentials - Always visible */}
            <div ref={step1Ref}>
              <Card className={shouldHighlightStep === 1 ? "border-primary shadow-lg transition-all" : ""}>
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
            </div>

            {/* Step 2: Program & Child Selection - Always visible, locked if no credentials */}
            <div ref={step2Ref}>
              {!form.watch('credentialId') ? (
                <LockedStepPreview
                  stepNumber={2}
                  title="Program & Child"
                  description="Choose the program and child to register"
                  prerequisite="selecting login credentials"
                />
              ) : (
                <Card className={shouldHighlightStep === 2 ? "border-primary shadow-lg transition-all" : ""}>
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
                                setSelectedBranch('');
                                setPrerequisiteChecks([]);
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
              )}
            </div>

            {/* Step 3: Prerequisites Check - Always visible, locked if Step 2 incomplete */}
            <div ref={step3Ref}>
              {!form.watch('programRef') || !form.watch('childId') || !form.watch('credentialId') ? (
                <LockedStepPreview
                  stepNumber={3}
                  title="Account Prerequisites"
                  description="Verify your account status and membership"
                  prerequisite="selecting a program and child"
                  icon={<Shield className="h-4 w-4" />}
                />
              ) : (
                <Card className={shouldHighlightStep === 3 ? "border-primary shadow-lg transition-all" : ""}>
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
                  {/* Loading state while fetching child name */}
                  {prerequisiteStatus === 'complete' && !selectedChildName && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Preparing next steps...
                    </div>
                  )}
                  
                  {/* Phase 2.5: Green Light / Yellow Light UI */}
                  {prerequisiteStatus === 'complete' && prerequisiteFields.length === 0 && selectedChildName ? (
                    <Card className="border-green-200 bg-green-50">
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <CardTitle className="text-green-900">Prerequisites Complete</CardTitle>
                        </div>
                        <CardDescription className="text-green-700">
                          All prerequisites are met. Continue below to complete your registration plan!
                        </CardDescription>
                      </CardHeader>
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
                      <PrerequisitesPanel
                        key={`prereqs-${prerequisiteChecks.length}`}
                        checks={prerequisiteChecks}
                        metadata={discoveryMetadata}
                        onRecheck={handleCheckPrerequisitesOnly}
                        onContinue={() => {
                          step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setShouldHighlightStep(4);
                          setTimeout(() => setShouldHighlightStep(null), 3000);
                        }}
                      />
                      
                      {/* Discovery Coverage Details */}
                      {discoveryMetadata && (
                        <DiscoveryCoverage metadata={discoveryMetadata} />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              )}
            </div>

            {/* V1: Program Questions Disclaimer - Show immediately after prerequisites pass */}
            {allRequirementsMet && !isDiscovering && (
              <ProgramQuestionsAutoAnswered questions={[]} />
            )}

            {/* Step 4: Registration Timing - Always visible, locked if prerequisites not met */}
            <div ref={step4Ref}>
              {(() => {
                const canShowStep4 = allRequirementsMet || prereqComplete;
                return !canShowStep4 || isDiscovering ? (
                  <LockedStepPreview
                    stepNumber={4}
                    title="Registration Timing"
                    description="When should automated registration begin?"
                    prerequisite="completing account prerequisites"
                  />
                ) : (
                  <>
                    {shouldHighlightStep === 4 && (
                      <Alert className="mb-4 border-primary bg-primary/5">
                        <AlertDescription className="text-primary font-medium text-center">
                          👇 Continue below to set registration time and complete your plan
                        </AlertDescription>
                      </Alert>
                    )}
                    <Card className={shouldHighlightStep === 4 ? "border-primary shadow-lg transition-all" : ""}>
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
                  </>
                );
              })()}
            </div>

            {/* Step 5: Payment Limit - Always visible, locked if opensAt not set */}
            <div ref={step5Ref}>
              {!opensAt || showMandateSummary ? (
                <LockedStepPreview
                  stepNumber={5}
                  title="Payment Limit"
                  description="Set maximum charge authorization"
                  prerequisite="setting registration time"
                  icon={<DollarSign className="h-4 w-4" />}
                />
              ) : (
                <Card className={shouldHighlightStep === 5 ? "border-primary shadow-lg transition-all" : ""}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">Step 5</Badge>
                        <CardTitle className="flex items-center gap-2">
                          <DollarSign className="h-5 w-5" />
                          {prompts.ui.titles.limit}
                        </CardTitle>
                      </div>
                      {maxAmountCents > 0 && <CheckCircle className="h-5 w-5 text-green-600" />}
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
                                inputMode="decimal"
                                placeholder="$0.00"
                                className="pl-7"
                                value={Number.isFinite(field.value / 100) ? String(field.value / 100) : ''}
                                onChange={(e) => {
                                  const val = Number(e.target.value.replace(/[^\d.]/g, '')) || 0;
                                  field.onChange(Math.round(val * 100));
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
            </div>

            {/* Step 6: Contact Information - Always visible, locked if payment limit not set */}
            <div ref={step6Ref}>
              {!opensAt || maxAmountCents <= 0 || showMandateSummary ? (
                <LockedStepPreview
                  stepNumber={6}
                  title="Contact Information"
                  description="Mobile number for notifications"
                  prerequisite="setting payment limit"
                />
              ) : (
                <Card className={shouldHighlightStep === 6 ? "border-primary shadow-lg transition-all" : ""}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">Step 6</Badge>
                        <CardTitle>{prompts.ui.titles.contact}</CardTitle>
                      </div>
                      {contactPhone && <CheckCircle className="h-5 w-5 text-green-600" />}
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
            </div>

            {/* Step 7: Payment Method - Always visible, locked if contact info not provided */}
            <div ref={step7Ref}>
              {(() => {
                console.log('[Step7] 🔍 About to evaluate unlock conditions...');
                
                // Step 7 should be unlocked when all basic requirements are met
                // Don't lock it when showMandateSummary is true - we want to show the saved payment method
                const shouldShowLocked = !opensAt || maxAmountCents <= 0 || !contactPhone;
                
                console.log('[Step7 Payment Method] Unlock conditions:', {
                  opensAt,
                  opensAtTruthy: !!opensAt,
                  opensAtType: typeof opensAt,
                  opensAtValue: opensAt?.toString(),
                  maxAmountCents,
                  maxAmountPositive: maxAmountCents > 0,
                  contactPhone,
                  contactPhoneTruthy: !!contactPhone,
                  showMandateSummary,
                  shouldShowLocked,
                  REASON: !opensAt ? 'no opensAt' : maxAmountCents <= 0 ? 'maxAmount <= 0' : !contactPhone ? 'no contactPhone' : 'none - UNLOCKED'
                });
                
                console.log('[Step7] 🎯 Rendering:', shouldShowLocked ? 'LockedStepPreview' : 'SavePaymentMethod Card');
                
                return shouldShowLocked;
              })() ? (
                <LockedStepPreview
                  stepNumber={7}
                  title="Payment Method"
                  description="Secure payment authorization for the $20 success fee"
                  prerequisite="providing contact information"
                  icon={<DollarSign className="h-4 w-4" />}
                />
              ) : (
                <div key="payment-method-step">
                  <SavePaymentMethod 
                    onPaymentMethodSaved={handlePaymentMethodSaved}
                    hasPaymentMethod={hasPaymentMethod}
                  />
                </div>
              )}
            </div>

            {/* Step 8: Mandate Summary & Finalize */}
            {canShowMandateButton && showMandateSummary && !showConfirmation && (
              <MandateSummary
                childId={childId}
                childName={selectedChildName}
                programRef={programRef}
                credentialId={credentialId}
                openTimeISO={openTimeISO}
                orgRef="blackhawk-ski-club"
                programTitle={friendlyProgramTitle || programRef}
                answers={form.watch('answers') || {}}
                detectedPriceCents={detectedPriceCents}
                caps={{
                  max_provider_charge_cents: form.watch('maxAmountCents'),
                  service_fee_cents: caps.service_fee_cents
                }}
                preferredSlot={selectedBranch || 'Standard Registration'}
                onCreated={(planId, mandateId, opensAt) => {
                  setCreatedPlan({ plan_id: planId, mandate_id: mandateId, opens_at: opensAt });
                  setShowConfirmation(true);
                  setShowMandateSummary(false);
                }}
                mandateConsents={mandateFlags?.map(v => v === true)}
                onMandateConsentsChange={(newConsents) => {
                  form.setValue('mandate.login', newConsents[0] || false);
                  form.setValue('mandate.fill', newConsents[1] || false);
                  form.setValue('mandate.questions', newConsents[2] || false);
                  form.setValue('mandate.payUpTo', newConsents[3] || false);
                  form.setValue('mandate.pause', newConsents[4] || false);
                  form.setValue('mandate.audit', newConsents[5] || false);
                }}
              />
            )}

            {/* Step 9: Plan Created - Show Execution Status */}
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

            {/* V1: Plan Preview removed - no discovered fields */}

            {/* Action Buttons */}
            {!showMandateSummary && !showConfirmation && canShowMandateButton && (
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
                  disabled={!canShowMandateButton}
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
            answers: form.watch('answers'),
            maxAmountCents: form.watch('maxAmountCents'),
            contactPhone: form.watch('contactPhone'),
            prereqComplete: form.watch('prereqComplete'),
          }}
          watch={form.watch}
          setValue={form.setValue}
          draftKey="plan-builder"
          triggerReload={reloadTrigger}
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