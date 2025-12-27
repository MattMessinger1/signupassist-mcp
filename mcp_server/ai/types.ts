/**
 * Shared type definitions for orchestrators
 * Build cache invalidation: 2025-12-08T16:45:00Z
 */

export interface ButtonSpec {
  label: string;
  action: string;
  payload?: any;
  variant?: "accent" | "secondary" | "ghost" | "outline";
}

export interface CardSpec {
  title: string;
  subtitle?: string;
  description?: string;
  buttons?: ButtonSpec[];
  metadata?: Record<string, any>;
}

export interface OrchestratorResponse {
  message: string;
  cards?: CardSpec[];
  cta?: {
    buttons: ButtonSpec[];
  };
  metadata?: any;
  // Optional context snapshot (used by HTTP guardrails to render progress headers)
  context?: Record<string, any>;
  // Optional step hint (mirrors context.step)
  step?: string;
  
  // ChatGPT Apps SDK fields
  /** Structured content visible to the model for reasoning */
  structuredContent?: Record<string, any>;
  /** Widget metadata - only visible to widget, not model */
  _meta?: {
    componentType?: string;
    cards?: CardSpec[];
    orgRef?: string;
    programRef?: string;
    formData?: Record<string, any>;
    [key: string]: any;
  };
}

/**
 * IOrchestrator Interface
 * Unified interface for both AIOrchestrator (legacy) and APIOrchestrator (new)
 * Allows dynamic switching between orchestrators via feature flag
 */
export interface IOrchestrator {
  /**
   * Main entry point: process user message or action
   * @param userTimezone - User's IANA timezone (e.g., 'America/Chicago')
   * @param userId - Optional authenticated user ID (from frontend or Auth0 JWT)
   */
  generateResponse(
    input: string,
    sessionId: string,
    action?: string,
    payload?: any,
    userTimezone?: string,
    userId?: string
  ): Promise<OrchestratorResponse | null>;
  
  /**
   * Reset session context
   */
  resetContext(sessionId: string): void;
}
