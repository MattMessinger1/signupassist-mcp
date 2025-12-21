/**
 * MultiStepRegistrationForm - Main form orchestrator
 * Manages the 3-step registration flow using window.openai state
 */

import React, { useState } from 'react';
import { StepIndicator } from './ui/StepIndicator';
import { GuardianInfoStep, ParticipantInfoStep, ReviewStep } from './form';
import { useToolOutput, useWidgetState, useCallTool } from '../hooks/useOpenAiGlobal';
import type { DelegateProfile, OpenAIWidgetState } from '../types/openai';

const STEP_LABELS = ['Your Info', 'Participants', 'Review'];

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
  };
  const currentStep = stepMap[widgetState.step] || 1;

  const handleGuardianSubmit = (data: DelegateProfile) => {
    setWidgetState({ 
      guardianData: data, 
      step: 'form_participant' 
    });
  };

  const handleParticipantSubmit = (participants: any[], saveNew: boolean[]) => {
    setWidgetState({ 
      participantData: participants,
      step: 'review' 
    });
  };

  const handleBack = (toStep: OpenAIWidgetState['step']) => {
    setWidgetState({ step: toStep });
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await callTool('submit_registration', {
        delegate: widgetState.guardianData,
        participants: widgetState.participantData,
        program_ref: widgetState.selectedProgram?.program_ref,
      });
      setWidgetState({ step: 'complete' });
    } catch (error) {
      console.error('Registration failed:', error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <StepIndicator 
        currentStep={currentStep} 
        totalSteps={3} 
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
          onConfirm={handleConfirm}
          onBack={() => handleBack('form_participant')}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
