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
}

/**
 * IOrchestrator Interface
 * Unified interface for both AIOrchestrator (legacy) and APIOrchestrator (new)
 * Allows dynamic switching between orchestrators via feature flag
 */
export interface IOrchestrator {
  /**
   * Main entry point: process user message or action
   */
  generateResponse(
    input: string,
    sessionId: string,
    action?: string,
    payload?: any
  ): Promise<OrchestratorResponse>;
  
  /**
   * Reset session context
   */
  resetContext(sessionId: string): void;
}
