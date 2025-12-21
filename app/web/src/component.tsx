/**
 * SignupAssist ChatGPT Widget Entry Point
 * This is the main component that ChatGPT will render in its iframe
 */

import React from 'react';
import { useToolOutput, useWidgetState } from './hooks/useOpenAiGlobal';
import { MultiStepRegistrationForm } from './components/MultiStepRegistrationForm';
import type { OpenAIWidgetState } from './types/openai';

/**
 * WidgetRoot - Routes to appropriate UI based on toolOutput.metadata.componentType
 */
export function WidgetRoot() {
  const toolOutput = useToolOutput();
  const [widgetState] = useWidgetState<OpenAIWidgetState>();

  // Route based on componentType from backend
  const componentType = toolOutput?.metadata?.componentType;

  switch (componentType) {
    case 'fullscreen_form':
    case 'form_step':
      return <MultiStepRegistrationForm />;
    
    case 'confirmation':
      return (
        <div className="p-6 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-semibold mb-2">Registration Complete!</h2>
          <p className="text-gray-600">{toolOutput?.message || 'Your registration has been submitted.'}</p>
        </div>
      );
    
    default:
      // Fallback: show message if present
      if (toolOutput?.message) {
        return (
          <div className="p-4">
            <p className="text-gray-800">{toolOutput.message}</p>
          </div>
        );
      }
      return null;
  }
}

// Export for ChatGPT Apps SDK
export default WidgetRoot;
