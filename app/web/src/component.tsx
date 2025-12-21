/**
 * SignupAssist ChatGPT Widget Entry Point
 * 
 * Routes to appropriate UI based on toolOutput.metadata.componentType
 * Supports all widget component types from the orchestrator.
 */

import React, { Component, type ReactNode } from 'react';
import { useToolOutput, useWidgetState, useSendMessage } from './hooks/useOpenAiGlobal';
import { MultiStepRegistrationForm } from './components/MultiStepRegistrationForm';
import { AuthCheck } from './components/AuthCheck';
import { ProgramSelector, type ProgramSelectorPayload } from './components/ProgramSelector';
import { ProviderConnect } from './components/ProviderConnect';
import { AuditTrailSummary, type AuditEvent } from './components/AuditTrailSummary';
import { ConfirmationStep } from './components/form/ConfirmationStep';
import type { OpenAIWidgetState } from './types/openai';

// ============ Error Boundary ============

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[Widget] Error caught by boundary:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <svg className="h-6 w-6 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We encountered an unexpected error. Please try again.
          </p>
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mt-4 text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer">Error Details</summary>
              <pre className="mt-2 p-2 bg-muted rounded overflow-auto max-h-32">
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

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
  confirmationNumber,
  programName 
}: { 
  confirmationNumber?: string;
  programName?: string;
}) {
  return (
    <ConfirmationStep
      confirmationNumber={confirmationNumber}
      program={programName ? { title: programName } : undefined}
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
          <AuthCheck onAuthenticated={handleAuthSuccess} />
        </div>
      );

    // ============ Confirmation ============
    case 'confirmation':
      return (
        <div className="p-4">
          <ConfirmationView
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

/**
 * Wrapped WidgetRoot with error boundary for production safety
 */
export function WidgetRootWithErrorBoundary() {
  return (
    <WidgetErrorBoundary>
      <WidgetRoot />
    </WidgetErrorBoundary>
  );
}

// Export wrapped version as default for ChatGPT Apps SDK
export default WidgetRootWithErrorBoundary;
