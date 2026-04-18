/**
 * Registration Flow Orchestrator
 * Manages the end-to-end registration and payment process with enhanced validation
 */

import { supabase } from '@/integrations/supabase/client';
import { mapFormDataToBackend, validateFieldMapping, createRegistrationPayload } from './fieldMapping';
import type { BackendFieldSchema, MappedFieldData } from './fieldMapping';
import { useToast } from '@/hooks/use-toast';
import { showSuccessToast, showErrorToast } from './toastHelpers';
import { prompts } from './prompts';
import type { ProviderReadinessLevel } from './providerLearning';
import type { SensitiveActionResultStatus } from './sensitiveActionGates';

export interface RegistrationFlowResult {
  success: boolean;
  status: SensitiveActionResultStatus;
  registrationRef?: string;
  confirmationRef?: string;
  errors: string[];
  warnings: string[];
  coverageReport?: MappedFieldData['coverage_report'];
}

export interface RegistrationFlowOptions {
  planId: string;
  mandateId: string;
  programRef: string;
  childId: string;
  selectedBranch: string;
  answers: Record<string, unknown>;
  discoveredSchema: BackendFieldSchema;
  childData: { name: string; dob: string };
  paymentRequired?: boolean;
  amountCents?: number;
  registrationConfirmationId?: string;
  paymentConfirmationId?: string;
  idempotencyKey?: string;
  providerKey?: string;
  providerReadinessLevel?: ProviderReadinessLevel;
  targetUrl?: string;
  maxTotalCents?: number;
  strictValidation?: boolean;
}

export interface PaymentFlowOptions {
  registrationRef: string;
  amountCents: number;
  mandateId: string;
  planExecutionId: string;
  paymentConfirmationId?: string;
  idempotencyKey?: string;
  providerKey?: string;
  providerReadinessLevel?: ProviderReadinessLevel;
  targetUrl?: string;
  exactProgram?: string;
  maxTotalCents?: number;
}

interface RegistrationPayload extends Record<string, unknown> {
  plan_execution_id: string;
  mandate_id: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Orchestrates the complete registration and payment flow
 */
export async function executeRegistrationFlow(
  options: RegistrationFlowOptions
): Promise<RegistrationFlowResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Step 1: Map and validate field data
    console.log('Step 1: Mapping form data to backend format...');
    const mappedData = mapFormDataToBackend(
      {
        answers: options.answers,
        childId: options.childId,
        selectedBranch: options.selectedBranch
      },
      options.discoveredSchema,
      options.childData
    );

    // Step 2: Validate field mapping
    console.log('Step 2: Validating field mapping...');
    const validation = validateFieldMapping(mappedData, options.strictValidation);
    
    if (!validation.isValid && options.strictValidation) {
      return {
        success: false,
        status: 'failed',
        errors: validation.errors,
        warnings: validation.warnings,
        coverageReport: mappedData.coverage_report
      };
    }

    // Add validation warnings to our warnings array
    warnings.push(...validation.warnings);

    // Step 3: Create registration payload
    console.log('Step 3: Creating registration payload...');
    const registrationPayload = createRegistrationPayload(
      options.planId,
      options.mandateId,
      mappedData,
      {
        programRef: options.programRef,
        childId: options.childId
      }
    ) as RegistrationPayload;

    if (!options.registrationConfirmationId) {
      return {
        success: false,
        status: 'requires_parent_confirmation',
        errors: ['Parent confirmation is required before SignupAssist can submit registration.'],
        warnings,
        coverageReport: mappedData.coverage_report
      };
    }

    // Step 4: Execute registration via MCP
    console.log('Step 4: Executing registration...');
    const registrationResult = await executeRegistration(registrationPayload, {
      confirmationId: options.registrationConfirmationId,
      idempotencyKey: options.idempotencyKey,
      providerKey: options.providerKey,
      providerReadinessLevel: options.providerReadinessLevel,
      targetUrl: options.targetUrl,
      exactProgram: options.programRef,
      maxTotalCents: options.maxTotalCents,
      amountCents: options.amountCents,
    });
    
    if (!registrationResult.success) {
      return {
        success: false,
        status: registrationResult.status || 'failed',
        errors: [...errors, ...(registrationResult.errors || [])],
        warnings,
        coverageReport: mappedData.coverage_report
      };
    }

    if (options.paymentRequired && options.amountCents) {
      warnings.push('Registration submitted; payment is paused for separate parent review.');

      return {
        success: true,
        status: 'payment_review_required',
        registrationRef: registrationResult.registrationRef,
        errors,
        warnings,
        coverageReport: mappedData.coverage_report
      };
    }

    return {
      success: true,
      status: 'registration_submitted',
      registrationRef: registrationResult.registrationRef,
      errors,
      warnings,
      coverageReport: mappedData.coverage_report
    };

  } catch (error) {
    console.error('Registration flow error:', error);
    return {
      success: false,
      status: 'failed',
      errors: [...errors, `Registration flow failed: ${errorMessage(error)}`],
      warnings
    };
  }
}

/**
 * Executes the registration step via Supabase function
 */
async function executeRegistration(
  payload: RegistrationPayload,
  gate: {
    confirmationId: string;
    idempotencyKey?: string;
    providerKey?: string;
    providerReadinessLevel?: ProviderReadinessLevel;
    targetUrl?: string;
    exactProgram?: string;
    amountCents?: number;
    maxTotalCents?: number;
  }
): Promise<{
  success: boolean;
  status?: SensitiveActionResultStatus;
  registrationRef?: string;
  errors?: string[];
}> {
  try {
    const { data, error } = await supabase.functions.invoke('run-plan', {
      body: {
        plan_id: payload.plan_execution_id,
        action: 'register',
        parameters: {
          ...payload,
          parent_action_confirmation_id: gate.confirmationId,
          idempotency_key: gate.idempotencyKey,
          provider_key: gate.providerKey,
          provider_readiness_level: gate.providerReadinessLevel,
          target_url: gate.targetUrl,
          exact_program: gate.exactProgram,
          amount_cents: gate.amountCents,
          max_total_cents: gate.maxTotalCents,
        }
      }
    });

    if (error) {
      console.error('Registration error:', error);
      const errorMessage = error.message?.toUpperCase().replace(/ /g, '_') || 'UNKNOWN_ERROR';
      const mappedError = prompts.backend.errors[errorMessage as keyof typeof prompts.backend.errors] 
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        status: 'failed',
        errors: [mappedError]
      };
    }

    if (data?.error) {
      const errorCode = data.error.toUpperCase().replace(/ /g, '_');
      const mappedError = prompts.backend.errors[errorCode as keyof typeof prompts.backend.errors]
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        status: data?.status || 'failed',
        errors: [mappedError]
      };
    }

    return {
      success: true,
      status: data?.status || 'registration_submitted',
      registrationRef: data?.registration_ref || data?.result?.registration_ref
    };

  } catch (error) {
    console.error('Registration execution error:', error);
    return {
      success: false,
      status: 'failed',
      errors: [`Registration execution failed: ${errorMessage(error)}`]
    };
  }
}

/**
 * Executes the payment step via Supabase function after separate parent review.
 */
export async function executePaymentFlow(options: PaymentFlowOptions): Promise<{
  success: boolean;
  status: SensitiveActionResultStatus;
  confirmationRef?: string;
  errors?: string[];
}> {
  if (!options.paymentConfirmationId || !options.idempotencyKey) {
    return {
      success: false,
      status: 'payment_review_required',
      errors: ['Payment requires separate parent confirmation before SignupAssist can continue.'],
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('run-plan', {
      body: {
        plan_id: options.planExecutionId,
        action: 'pay',
        parameters: {
          registration_ref: options.registrationRef,
          amount_cents: options.amountCents,
          mandate_id: options.mandateId,
          plan_execution_id: options.planExecutionId,
          parent_action_confirmation_id: options.paymentConfirmationId,
          idempotency_key: options.idempotencyKey,
          provider_key: options.providerKey,
          provider_readiness_level: options.providerReadinessLevel,
          target_url: options.targetUrl,
          exact_program: options.exactProgram,
          max_total_cents: options.maxTotalCents,
        }
      }
    });

    if (error) {
      console.error('Payment error:', error);
      const errorMessage = error.message?.toUpperCase().replace(/ /g, '_') || 'UNKNOWN_ERROR';
      const mappedError = prompts.backend.errors[errorMessage as keyof typeof prompts.backend.errors]
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        status: 'failed',
        errors: [mappedError]
      };
    }

    if (data?.error) {
      const errorCode = data.error.toUpperCase().replace(/ /g, '_');
      const mappedError = prompts.backend.errors[errorCode as keyof typeof prompts.backend.errors]
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        status: data?.status || 'payment_review_required',
        errors: [mappedError]
      };
    }

    return {
      success: true,
      status: data?.status || 'payment_submitted',
      confirmationRef: data?.confirmation_ref || data?.result?.confirmation_ref
    };

  } catch (error) {
    console.error('Payment execution error:', error);
    return {
      success: false,
      status: 'failed',
      errors: [`Payment execution failed: ${errorMessage(error)}`]
    };
  }
}

/**
 * Hook for using the registration flow in React components
 */
export function useRegistrationFlow() {
  const { toast } = useToast();

  const executeFlow = async (options: RegistrationFlowOptions): Promise<RegistrationFlowResult> => {
    const result = await executeRegistrationFlow(options);

    // Show appropriate toast messages
    if (result.success) {
      if (result.status === 'payment_review_required') {
        toast({
          title: 'Payment Review Required',
          description: 'Registration was submitted. SignupAssist paused before payment for separate parent review.',
          variant: 'default',
        });
      } else {
        showSuccessToast(
          'Registration Successful',
          `Registration submitted. Reference: ${result.registrationRef}`
        );
      }
    } else {
      showErrorToast('Registration Failed', result.errors[0] || prompts.backend.errors.UNKNOWN_ERROR);
    }

    // Show warnings if any
    if (result.warnings.length > 0) {
      toast({
        title: 'Registration Warnings',
        description: result.warnings.join('. '),
        variant: 'default',
      });
    }

    return result;
  };

  return { executeFlow };
}
