/**
 * SignupAssist ChatGPT Widget Entry Point
 * 
 * Routes to appropriate UI based on toolOutput.metadata.componentType
 * Supports all widget component types from the orchestrator.
 */

import React from 'react';
import { useToolOutput, useWidgetState } from './hooks/useOpenAiGlobal';
import { MultiStepRegistrationForm } from './components/MultiStepRegistrationForm';
import { AuthCheck } from './components/AuthCheck';
import { ProgramSelector, type ProgramSelectorPayload } from './components/ProgramSelector';
import { ProviderConnect } from './components/ProviderConnect';
import { AuditTrailSummary, type AuditEvent } from './components/AuditTrailSummary';
import { ConfirmationStep } from './components/form/ConfirmationStep';
import type { OpenAIWidgetState } from './types/openai';

// ============ Types ============

type ComponentType = 
  | 'fullscreen_form'
  | 'form_step'
  | 'program_list'
  | 'provider_connect'
  | 'auth_required'
  | 'confirmation'
  | 'audit_trail'
  | 'error'
  | 'loading'
  | 'message';

interface ToolOutputMetadata {
  componentType?: ComponentType;
  provider?: string;
  orgName?: string;
  orgRef?: string;
  programRef?: string;
  mandateScopes?: string[];
  confirmationNumber?: string;
  programName?: string;
  [key: string]: unknown;
}

interface ToolOutput {
  message?: string;
  metadata?: ToolOutputMetadata;
  payload?: unknown;
  events?: AuditEvent[];
}

// ============ Sub-Components ============

interface MessageDisplayProps {
  message: string;
  type?: 'info' | 'error' | 'success';
}

function MessageDisplay({ message, type = 'info' }: MessageDisplayProps) {
  const styles = {
    info: 'bg-muted text-foreground',
    error: 'bg-destructive/10 text-destructive',
    success: 'bg-emerald-50 text-emerald-800',
  };

  return (
    <div className={`p-4 rounded-lg ${styles[type]}`}>
      <p className="text-sm">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div className="p-6 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h2 className="text-lg font-semibold text-destructive mb-2">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        {message || 'An error occurred. Please try again.'}
      </p>
    </div>
  );
}

function ConfirmationView({ 
  message, 
  confirmationNumber,
  programName 
}: { 
  message?: string;
  confirmationNumber?: string;
  programName?: string;
}) {
  return (
    <ConfirmationStep
      confirmationNumber={confirmationNumber}
      programName={programName}
      registrationData={{}}
    />
  );
}

// ============ Main Router ============

/**
 * WidgetRoot - Main entry point that routes to appropriate UI
 */
export function WidgetRoot() {
  const toolOutput = useToolOutput() as ToolOutput | null;
  const [widgetState, setWidgetState] = useWidgetState<OpenAIWidgetState>();

  // Extract routing info
  const componentType = toolOutput?.metadata?.componentType;
  const metadata = toolOutput?.metadata || {};

  // Handle program selection
  const handleProgramSelect = (programRef: string, orgRef: string, action: string) => {
    // Update widget state with selection
    setWidgetState({
      ...widgetState,
      selectedProgram: programRef,
      selectedOrg: orgRef,
      lastAction: action,
    });

    // Notify ChatGPT of selection via postback
    if (window.openai?.postback) {
      window.openai.postback({
        intent: action,
        program_ref: programRef,
        org_ref: orgRef,
      });
    }
  };

  // Handle provider connection success
  const handleProviderConnected = () => {
    setWidgetState({
      ...widgetState,
      providerConnected: true,
    });

    if (window.openai?.postback) {
      window.openai.postback({
        intent: 'provider_connected',
        provider: metadata.provider,
        org_ref: metadata.orgRef,
      });
    }
  };

  // Handle auth success
  const handleAuthSuccess = () => {
    setWidgetState({
      ...widgetState,
      authenticated: true,
    });

    if (window.openai?.postback) {
      window.openai.postback({
        intent: 'auth_completed',
      });
    }
  };

  // Route based on componentType
  switch (componentType) {
    // ============ Form Components ============
    case 'fullscreen_form':
    case 'form_step':
      return <MultiStepRegistrationForm />;

    // ============ Program Discovery ============
    case 'program_list':
      const programPayload = toolOutput?.payload as ProgramSelectorPayload | undefined;
      if (!programPayload) {
        return <MessageDisplay message="No programs available." type="info" />;
      }
      return (
        <div className="p-4">
          <ProgramSelector
            payload={programPayload}
            onSelect={handleProgramSelect}
            onChipClick={(payload) => {
              if (window.openai?.postback) {
                window.openai.postback(payload);
              }
            }}
          />
        </div>
      );

    // ============ Provider Connection ============
    case 'provider_connect':
      return (
        <div className="p-4 flex justify-center">
          <ProviderConnect
            provider={metadata.provider || 'unknown'}
            orgName={metadata.orgName || 'Provider'}
            orgRef={metadata.orgRef || ''}
            onSuccess={handleProviderConnected}
            onError={(error) => {
              console.error('[WidgetRoot] Provider connect error:', error);
            }}
          />
        </div>
      );

    // ============ Authentication ============
    case 'auth_required':
      return (
        <div className="p-4">
          <AuthCheck onAuthSuccess={handleAuthSuccess} />
        </div>
      );

    // ============ Confirmation ============
    case 'confirmation':
      return (
        <div className="p-4">
          <ConfirmationView
            message={toolOutput?.message}
            confirmationNumber={metadata.confirmationNumber}
            programName={metadata.programName}
          />
        </div>
      );

    // ============ Audit Trail ============
    case 'audit_trail':
      const auditEvents = toolOutput?.events || [];
      return (
        <div className="p-4">
          <AuditTrailSummary
            events={auditEvents}
            mandateScopes={metadata.mandateScopes}
          />
        </div>
      );

    // ============ Error State ============
    case 'error':
      return <ErrorState message={toolOutput?.message} />;

    // ============ Loading State ============
    case 'loading':
      return <LoadingState />;

    // ============ Simple Message ============
    case 'message':
      return (
        <div className="p-4">
          <MessageDisplay message={toolOutput?.message || ''} />
        </div>
      );

    // ============ Default/Fallback ============
    default:
      // Show message if present, otherwise nothing
      if (toolOutput?.message) {
        return (
          <div className="p-4">
            <MessageDisplay message={toolOutput.message} />
          </div>
        );
      }
      return null;
  }
}

// Export for ChatGPT Apps SDK
export default WidgetRoot;
