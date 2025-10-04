/**
 * Registration Flow Orchestrator
 * Manages the end-to-end registration and payment process with enhanced validation
 */

import { supabase } from '@/integrations/supabase/client';
import { mapFormDataToBackend, validateFieldMapping, createRegistrationPayload, MappedFieldData } from './fieldMapping';
import { useToast } from '@/hooks/use-toast';
import { showPromptToast, showSuccessToast, showErrorToast } from './toastHelpers';
import { prompts } from './prompts';

export interface RegistrationFlowResult {
  success: boolean;
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
  answers: Record<string, any>;
  discoveredSchema: any;
  childData: { name: string; dob: string };
  paymentRequired?: boolean;
  amountCents?: number;
  strictValidation?: boolean;
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
    );

    // Step 4: Execute registration via MCP
    console.log('Step 4: Executing registration...');
    const registrationResult = await executeRegistration(registrationPayload);
    
    if (!registrationResult.success) {
      return {
        success: false,
        errors: [...errors, ...(registrationResult.errors || [])],
        warnings,
        coverageReport: mappedData.coverage_report
      };
    }

    let confirmationRef: string | undefined;

    // Step 5: Execute payment if required
    if (options.paymentRequired && options.amountCents && registrationResult.registrationRef) {
      console.log('Step 5: Executing payment...');
      const paymentResult = await executePayment({
        registrationRef: registrationResult.registrationRef,
        amountCents: options.amountCents,
        mandateId: options.mandateId,
        planExecutionId: options.planId
      });

      if (!paymentResult.success) {
        warnings.push('Registration succeeded but payment failed');
        warnings.push(...(paymentResult.errors || []));
      } else {
        confirmationRef = paymentResult.confirmationRef;
      }
    }

    return {
      success: true,
      registrationRef: registrationResult.registrationRef,
      confirmationRef,
      errors,
      warnings,
      coverageReport: mappedData.coverage_report
    };

  } catch (error) {
    console.error('Registration flow error:', error);
    return {
      success: false,
      errors: [...errors, `Registration flow failed: ${error.message}`],
      warnings
    };
  }
}

/**
 * Executes the registration step via Supabase function
 */
async function executeRegistration(payload: any): Promise<{
  success: boolean;
  registrationRef?: string;
  errors?: string[];
}> {
  try {
    const { data, error } = await supabase.functions.invoke('run-plan', {
      body: {
        plan_id: payload.plan_execution_id,
        action: 'register',
        parameters: payload
      }
    });

    if (error) {
      console.error('Registration error:', error);
      const errorMessage = error.message?.toUpperCase().replace(/ /g, '_') || 'UNKNOWN_ERROR';
      const mappedError = prompts.backend.errors[errorMessage as keyof typeof prompts.backend.errors] 
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        errors: [mappedError]
      };
    }

    if (data?.error) {
      const errorCode = data.error.toUpperCase().replace(/ /g, '_');
      const mappedError = prompts.backend.errors[errorCode as keyof typeof prompts.backend.errors]
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        errors: [mappedError]
      };
    }

    return {
      success: true,
      registrationRef: data?.registration_ref || data?.result?.registration_ref
    };

  } catch (error) {
    console.error('Registration execution error:', error);
    return {
      success: false,
      errors: [`Registration execution failed: ${error.message}`]
    };
  }
}

/**
 * Executes the payment step via Supabase function
 */
async function executePayment(options: {
  registrationRef: string;
  amountCents: number;
  mandateId: string;
  planExecutionId: string;
}): Promise<{
  success: boolean;
  confirmationRef?: string;
  errors?: string[];
}> {
  try {
    const { data, error } = await supabase.functions.invoke('run-plan', {
      body: {
        plan_id: options.planExecutionId,
        action: 'pay',
        parameters: {
          registration_ref: options.registrationRef,
          amount_cents: options.amountCents,
          mandate_id: options.mandateId,
          plan_execution_id: options.planExecutionId
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
        errors: [mappedError]
      };
    }

    if (data?.error) {
      const errorCode = data.error.toUpperCase().replace(/ /g, '_');
      const mappedError = prompts.backend.errors[errorCode as keyof typeof prompts.backend.errors]
        || prompts.backend.errors.UNKNOWN_ERROR;
      return {
        success: false,
        errors: [mappedError]
      };
    }

    return {
      success: true,
      confirmationRef: data?.confirmation_ref || data?.result?.confirmation_ref
    };

  } catch (error) {
    console.error('Payment execution error:', error);
    return {
      success: false,
      errors: [`Payment execution failed: ${error.message}`]
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
      showSuccessToast(
        'Registration Successful',
        `Registration completed${result.confirmationRef ? ' with payment' : ''}. Reference: ${result.registrationRef}`
      );
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