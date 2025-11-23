/**
 * Design DNA Validator for SignupAssist
 * Enforces Design DNA principles from design_dna-2.pdf
 */

import { validateTone, determineToneContext, type ToneContext } from '../../src/lib/toneValidator.js';
import type { OrchestratorResponse, CardSpec } from './types.js';

export interface DesignDNAValidation {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

export interface DesignDNAContext {
  step: 'browse' | 'form' | 'payment';
  isWriteAction: boolean; // payment or registration
}

/**
 * Comprehensive Design DNA validator for all orchestrator responses
 */
export function validateDesignDNA(
  response: OrchestratorResponse,
  context: DesignDNAContext
): DesignDNAValidation {
  const issues: string[] = [];
  const warnings: string[] = [];

  // 1. Chat-native flow: Message → Card → CTA pattern
  if (!response.message) {
    issues.push('Missing assistant message (violates Message → Card → CTA pattern)');
  }

  // 2. Explicit confirmation for writes
  if (context.isWriteAction && context.step === 'payment') {
    const hasConfirmationCard = response.cards?.some(c => 
      c.title?.toLowerCase().includes('confirm') || 
      c.title?.toLowerCase().includes('booking') ||
      c.description?.toLowerCase().includes('confirm')
    );
    if (!hasConfirmationCard) {
      issues.push('Missing confirmation card before payment (OpenAI requirement)');
    }

    // Check for explicit authorization language
    const hasAuthLanguage = /authorize|explicit consent|confirm|proceed/i.test(response.message || '');
    if (!hasAuthLanguage) {
      warnings.push('Consider adding explicit authorization language ("By proceeding, you authorize...")');
    }
  }

  // 3. Visual hierarchy (button variants)
  const buttons = [
    ...(response.cta?.buttons || []),
    ...(response.cards?.flatMap(c => c.buttons || []) || [])
  ];
  
  const primaryCount = buttons.filter(b => b.variant === 'accent').length;
  if (primaryCount > 1) {
    warnings.push(`Multiple primary (accent) buttons detected (${primaryCount}). Use one primary, rest secondary/ghost.`);
  }

  // 4. Tone validation (parent-friendly, concise)
  if (response.message) {
    const toneContext: ToneContext = {
      requiresConfirmation: context.isWriteAction,
      isSecuritySensitive: context.step === 'payment',
      stepName: context.step
    };
    const toneValidation = validateTone(response.message, toneContext);
    
    if (toneValidation.issues.length > 0) {
      issues.push(...toneValidation.issues.map(i => `Tone: ${i}`));
    }
  }

  // 5. Security context (required for payment steps)
  if (context.step === 'payment' && response.message) {
    const hasSecurityNote = /secure|encrypted|never store|stays with|provider|handles payment/i.test(response.message);
    if (!hasSecurityNote) {
      warnings.push('Missing security reassurance in payment step');
    }
  }

  // 6. Audit trail / Responsible Delegate reminder
  if (context.isWriteAction && response.message) {
    const hasAuditReminder = /explicit consent|log|responsible|authorize/i.test(response.message);
    if (!hasAuditReminder) {
      warnings.push('Consider adding Responsible Delegate reminder for write action');
    }
  }

  // 7. Data minimization check (for form steps)
  if (context.step === 'form' && response.metadata?.signupForm) {
    const formFields = response.metadata.signupForm;
    const hasExcessiveFields = formFields.length > 8;
    if (hasExcessiveFields) {
      warnings.push(`Form has ${formFields.length} fields. Consider splitting into multiple steps.`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Add Responsible Delegate footer to payment confirmations
 */
export function addResponsibleDelegateFooter(message: string): string {
  return `${message}

📋 *SignupAssist acts as your Responsible Delegate:* We only proceed with your explicit consent, log every action for your review, and charge only upon successful registration.`;
}

/**
 * Add security context for API providers (no login needed)
 */
export function addAPISecurityContext(message: string, providerName: string): string {
  return `${message}

🔒 *Your data stays secure:* ${providerName} handles all payment processing directly. SignupAssist never stores card numbers.`;
}
