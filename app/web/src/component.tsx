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
  org_ref?: string;
  programRef?: string;
  program_ref?: string;
  programName?: string;
  program_name?: string;
  programFeeCents?: number;
  numParticipants?: number;
  mandateScopes?: string[];
  confirmationNumber?: string;
  signupForm?: Record<string, any>;
  [key: string]: unknown;
}

interface CardSpec {
  title: string;
  subtitle?: string;
  description?: string;
  buttons?: Array<{
    label: string;
    action?: string;
    payload?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

interface ToolOutput {
  message?: string;
  metadata?: ToolOutputMetadata;
  payload?: unknown;
  events?: AuditEvent[];
  cards?: CardSpec[]; // Backend returns cards at top level
  cta?: Array<{ label: string; action?: string; payload?: Record<string, unknown> }>;
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

/**
 * Renders program cards from the flat `cards` array returned by the backend.
 * Converts backend CardSpec format to clickable program cards.
 */
interface ProgramCardListProps {
  cards: CardSpec[];
  cta?: Array<{ label: string; action?: string; payload?: Record<string, unknown> }>;
  onSelect?: (programRef: string, orgRef: string, action: string) => void;
  onChipClick?: (payload: Record<string, unknown>) => void;
}

function ProgramCardList({ cards, cta, onSelect, onChipClick }: ProgramCardListProps) {
  type ButtonType = NonNullable<CardSpec['buttons']>[number];
  
  const handleButtonClick = (card: CardSpec, button: ButtonType) => {
    if (!button) return;
    
    // Extract program_ref and org_ref from button payload (where backend puts them)
    const programData = button.payload?.program_data as Record<string, unknown> | undefined;
    const programRef = (programData?.program_ref as string) || 
                       (button.payload?.program_ref as string) || 
                       card.title;
    const orgRef = (programData?.org_ref as string) || 
                   (button.payload?.org_ref as string) || 
                   '';
    const action = button.action || 'select_program';
    
    if (onSelect) {
      onSelect(programRef, orgRef, action);
    }
    
    if (window.openai?.postback) {
      window.openai.postback({
        intent: action,
        program_ref: programRef,
        org_ref: orgRef,
        program_title: card.title,
        ...button.payload,
      });
    }
  };

  return (
    <div className="space-y-3">
      {cards.map((card, idx) => (
        <div
          key={idx}
          className="border border-border rounded-lg p-4 bg-card hover:shadow-md transition-shadow"
        >
          <h3 className="font-semibold text-foreground mb-1">{card.title}</h3>
          {card.subtitle && (
            <p className="text-sm text-muted-foreground mb-2">{card.subtitle}</p>
          )}
          {card.description && (
            <p className="text-sm text-muted-foreground mb-3">{card.description}</p>
          )}
          {card.buttons && card.buttons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {card.buttons.map((btn, btnIdx) => (
                <button
                  key={btnIdx}
                  onClick={() => handleButtonClick(card, btn)}
                  className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      
      {/* CTA chips at bottom */}
      {cta && cta.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border mt-4">
          {cta.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (onChipClick && chip.payload) {
                  onChipClick(chip.payload);
                }
                if (window.openai?.postback && chip.payload) {
                  window.openai.postback(chip.payload);
                }
              }}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
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

  // ChatGPT Apps SDK: Also check _meta for widget-specific data
  // The backend sends cards in both toolOutput.cards AND toolOutput._meta.cards
  const widgetMeta = (toolOutput as any)?._meta || {};
  const cardsFromMeta = widgetMeta.cards as CardSpec[] | undefined;
  
  // Prefer cards from _meta (ChatGPT Apps SDK format), fallback to top-level cards
  const effectiveCards = cardsFromMeta || toolOutput?.cards;
  const effectiveComponentType = widgetMeta.componentType || toolOutput?.metadata?.componentType;

  // DEBUG: Log raw toolOutput to help diagnose card rendering issues
  if (process.env.NODE_ENV === 'development' || (typeof window !== 'undefined' && (window as any).__WIDGET_DEBUG__)) {
    console.log('[WidgetRoot] 📦 Raw toolOutput:', JSON.stringify(toolOutput, null, 2));
    console.log('[WidgetRoot] 🔍 Parsed:', {
      hasMessage: !!toolOutput?.message,
      hasCards: !!effectiveCards,
      cardsCount: effectiveCards?.length || 0,
      hasCta: !!toolOutput?.cta,
      componentType: effectiveComponentType,
      hasPayload: !!toolOutput?.payload,
      hasMeta: !!widgetMeta.componentType,
    });
  }

  // Extract routing info - use effectiveComponentType from ChatGPT Apps SDK _meta
  const componentType = effectiveComponentType;
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
    case 'form_step': {
      // Initialize widget state for form flow if not already set
      const needsInit = widgetState.step === 'browse' || !widgetState.step;
      if (needsInit) {
        // Extract program info from metadata
        const programData = {
          title: metadata.programName || metadata.program_name || 'Program',
          program_ref: metadata.programRef || metadata.program_ref,
          org_ref: metadata.orgRef || metadata.org_ref,
          priceCents: metadata.programFeeCents || 0,
        };
        
        // Set initial form state
        setWidgetState({
          ...widgetState,
          step: 'form_guardian',
          selectedProgram: programData,
          numParticipants: (metadata as any).numParticipants || 1,
          guardianData: {},
          participantData: [],
        });
      }
      return <MultiStepRegistrationForm />;
    }

    // ============ Program Discovery ============
    case 'program_list':
      // Use effectiveCards which checks both _meta and top-level cards
      if (effectiveCards && effectiveCards.length > 0) {
        return (
          <div className="p-4">
            {toolOutput?.message && (
              <p className="text-sm text-muted-foreground mb-4">{toolOutput.message}</p>
            )}
            <ProgramCardList
              cards={effectiveCards}
              cta={toolOutput?.cta}
              onSelect={handleProgramSelect}
              onChipClick={(payload) => {
                if (window.openai?.postback) {
                  window.openai.postback(payload);
                }
              }}
            />
          </div>
        );
      }
      // Fallback to payload-based ProgramSelector if available
      const programPayload = toolOutput?.payload as ProgramSelectorPayload | undefined;
      if (programPayload) {
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
      }
      return <MessageDisplay message="No programs available." type="info" />;

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
      // Check if backend returned cards array (program listing without explicit componentType)
      // Use effectiveCards which checks both _meta and top-level cards
      if (effectiveCards && effectiveCards.length > 0) {
        return (
          <div className="p-4">
            {toolOutput?.message && (
              <p className="text-sm text-muted-foreground mb-4">{toolOutput.message}</p>
            )}
            <ProgramCardList
              cards={effectiveCards}
              cta={toolOutput?.cta}
              onSelect={handleProgramSelect}
              onChipClick={(payload) => {
                if (window.openai?.postback) {
                  window.openai.postback(payload);
                }
              }}
            />
          </div>
        );
      }
      
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
