/**
 * MultiStepRegistrationForm - Main form orchestrator
 * Manages the 4-step registration flow using window.openai state
 * Steps: Guardian Info → Participants → Review & Consent → Payment → Confirmation
 */

import React, { useState } from 'react';
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

  // Step 1: Guardian info submitted
  const handleGuardianSubmit = (data: DelegateProfile) => {
    setWidgetState({ 
      guardianData: data, 
      step: 'form_participant' 
    });
  };

  // Step 2: Participants submitted
  const handleParticipantSubmit = (participants: any[], saveNew: boolean[]) => {
    setWidgetState({ 
      participantData: participants,
      step: 'review' 
    });
  };

  // Step 3: Review confirmed, proceed to payment
  const handleReviewConfirm = async () => {
    setIsSubmitting(true);
    try {
      // Prepare registration (creates pending charge, etc.)
      await callTool('prepare_registration', {
        delegate: widgetState.guardianData,
        participants: widgetState.participantData,
        program_ref: widgetState.selectedProgram?.program_ref,
      });
      
      setWidgetState({ 
        consentGiven: true,
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
      // Submit the final registration
      const result = await callTool('submit_registration', {
        delegate: widgetState.guardianData,
        participants: widgetState.participantData,
        program_ref: widgetState.selectedProgram?.program_ref,
      });
      
      setWidgetState({ 
        paymentVerified: true,
        confirmationNumber: result?.confirmationNumber,
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
