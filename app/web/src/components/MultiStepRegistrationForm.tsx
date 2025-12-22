/**
 * MultiStepRegistrationForm - Main form orchestrator
 * Manages the 4-step registration flow using window.openai state
 * Steps: Guardian Info → Participants → Review & Consent → Payment → Confirmation
 * 
 * Includes audit event logging at each step for responsible delegate trail
 */

import React, { useState, useEffect } from 'react';
import { StepIndicator } from './ui/StepIndicator';
import { 
  GuardianInfoStep, 
  ParticipantInfoStep, 
  ReviewStep, 
  PaymentStep,
  ConfirmationStep 
} from './form';
import { useToolOutput, useWidgetState, useCallTool } from '../hooks/useOpenAiGlobal';
import type { DelegateProfile, OpenAIWidgetState } from '../types/openai';

const STEP_LABELS = ['Your Info', 'Participants', 'Review', 'Payment'];

export function MultiStepRegistrationForm() {
  const toolOutput = useToolOutput();
  const [widgetState, setWidgetState] = useWidgetState<OpenAIWidgetState>();
  const callTool = useCallTool();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Derive current step number from state
  const stepMap: Record<string, number> = {
    'form_guardian': 1,
    'form_participant': 2,
    'review': 3,
    'payment': 4,
  };
  const currentStep = stepMap[widgetState.step] || 1;

  // Log form_started event on mount
  useEffect(() => {
    if (widgetState.step === 'form_guardian') {
      callTool('mandates.log_audit_event', {
        event_type: 'form_started',
        metadata: {
          program_ref: widgetState.selectedProgram?.program_ref,
          num_participants: widgetState.numParticipants
        }
      }).catch(err => console.warn('Audit log failed:', err));
    }
  }, []); // Only on mount

  // Step 1: Guardian info submitted
  const handleGuardianSubmit = async (data: DelegateProfile) => {
    // Log delegate_submitted audit event
    try {
      await callTool('mandates.log_audit_event', {
        event_type: 'delegate_submitted',
        mandate_id: (widgetState as any).mandateId,
        metadata: {
          delegate_email: data.delegate_email,
          has_phone: !!data.delegate_phone
        }
      });
    } catch (err) {
      console.warn('Audit log failed:', err);
    }
    
    setWidgetState({ 
      guardianData: data, 
      step: 'form_participant' 
    });
  };

  // Step 2: Participants submitted
  const handleParticipantSubmit = async (participants: any[], saveNew: boolean[]) => {
    // Log participants_submitted audit event
    try {
      await callTool('mandates.log_audit_event', {
        event_type: 'participants_submitted',
        mandate_id: (widgetState as any).mandateId,
        metadata: {
          num_participants: participants.length,
          saved_new_count: saveNew.filter(Boolean).length
        }
      });
    } catch (err) {
      console.warn('Audit log failed:', err);
    }
    
    setWidgetState({ 
      participantData: participants,
      step: 'review' 
    });
  };

  // Step 3: Review confirmed, proceed to payment
  const handleReviewConfirm = async () => {
    setIsSubmitting(true);
    try {
      // Calculate total amount (program fee + service fee)
      const programFeeCents = widgetState.selectedProgram?.priceCents || 0;
      const serviceFeeCents = Math.round(programFeeCents * 0.05); // 5% service fee
      const totalAmountCents = programFeeCents + serviceFeeCents;
      
      // Prepare registration (creates mandate, validates data)
      // This internally logs consent_given
      const result = await callTool('mandates.prepare_registration', {
        user_id: 'widget-user', // Widget doesn't have full auth, backend will resolve
        delegate: widgetState.guardianData,
        participants: widgetState.participantData,
        program_ref: widgetState.selectedProgram?.program_ref,
        org_ref: widgetState.selectedProgram?.org_ref || 'aim-design',
        provider: 'bookeo',
        total_amount_cents: totalAmountCents
      });
      
      // Log consent_given audit event
      await callTool('mandates.log_audit_event', {
        event_type: 'consent_given',
        mandate_id: result?.data?.mandate_id,
        metadata: {
          total_amount_cents: totalAmountCents,
          program_ref: widgetState.selectedProgram?.program_ref
        }
      });
      
      setWidgetState({ 
        consentGiven: true,
        mandateId: result?.data?.mandate_id,
        step: 'payment' 
      });
    } catch (error) {
      console.error('Failed to prepare registration:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 4: Payment verified
  const handlePaymentComplete = async () => {
    setIsSubmitting(true);
    try {
      // Log payment_authorized audit event before submit
      await callTool('mandates.log_audit_event', {
        event_type: 'payment_authorized',
        mandate_id: (widgetState as any).mandateId,
        metadata: {
          program_ref: widgetState.selectedProgram?.program_ref
        }
      });
      
      // Submit the final registration using mandate
      const result = await callTool('mandates.submit_registration', {
        user_id: 'widget-user',
        mandate_id: (widgetState as any).mandateId,
        delegate: widgetState.guardianData,
        participants: widgetState.participantData,
        program_ref: widgetState.selectedProgram?.program_ref,
        org_ref: widgetState.selectedProgram?.org_ref || 'aim-design',
        provider: 'bookeo'
      });
      
      setWidgetState({ 
        paymentVerified: true,
        confirmationNumber: result?.data?.confirmation_number,
        step: 'confirmation' 
      });
    } catch (error) {
      console.error('Registration failed:', error);
      setIsSubmitting(false);
    }
  };

  // Navigation back handlers
  const handleBack = (toStep: OpenAIWidgetState['step']) => {
    setWidgetState({ step: toStep });
  };

  // Confirmation done
  const handleComplete = () => {
    setWidgetState({ step: 'complete' });
  };

  // Show confirmation step separately (no step indicator)
  if (widgetState.step === 'confirmation' || widgetState.step === 'complete') {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <ConfirmationStep
          guardianData={widgetState.guardianData}
          participantData={widgetState.participantData}
          program={widgetState.selectedProgram}
          confirmationNumber={widgetState.confirmationNumber}
          mandateId={(widgetState as any).mandateId}
          onDone={handleComplete}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <StepIndicator 
        currentStep={currentStep} 
        totalSteps={4} 
        stepLabels={STEP_LABELS}
      />

      {widgetState.step === 'form_guardian' && (
        <GuardianInfoStep
          initialData={widgetState.guardianData}
          onSubmit={handleGuardianSubmit}
        />
      )}

      {widgetState.step === 'form_participant' && (
        <ParticipantInfoStep
          savedChildren={toolOutput?.metadata?.savedChildren}
          numParticipants={widgetState.numParticipants}
          initialData={widgetState.participantData}
          onSubmit={handleParticipantSubmit}
          onBack={() => handleBack('form_guardian')}
        />
      )}

      {widgetState.step === 'review' && (
        <ReviewStep
          guardianData={widgetState.guardianData}
          participantData={widgetState.participantData}
          program={widgetState.selectedProgram}
          onConfirm={handleReviewConfirm}
          onBack={() => handleBack('form_participant')}
          isSubmitting={isSubmitting}
        />
      )}

      {widgetState.step === 'payment' && (
        <PaymentStep
          onPaymentComplete={handlePaymentComplete}
          onBack={() => handleBack('review')}
          programName={widgetState.selectedProgram?.title}
          totalAmount={
            (widgetState.selectedProgram?.priceCents || 0) + 
            (toolOutput?.metadata?.serviceFeeCents || 0)
          }
        />
      )}
    </div>
  );
}
