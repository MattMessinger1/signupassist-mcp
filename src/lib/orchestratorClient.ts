/**
 * Orchestrator Client
 * 
 * Client-side API for communicating with the AI Orchestrator backend.
 * Handles both text messages and card action clicks.
 */

const ORCHESTRATOR_BASE = import.meta.env.VITE_MCP_BASE_URL || 'http://localhost:8080';

export interface OrchestratorResponse {
  message: string;
  cards?: Array<{
    title: string;
    subtitle?: string;
    description?: string;
    metadata?: Record<string, any>;
    buttons?: Array<{
      label: string;
      action: string;
      variant?: "accent" | "outline";
    }>;
  }>;
  cta?: Array<{
    label: string;
    action: string;
    variant?: "accent" | "outline";
  }>;
  contextUpdates?: Record<string, any>;
}

/**
 * Send a text message to the orchestrator
 * @param message - User's text input
 * @param sessionId - Unique session identifier
 * @returns Promise resolving to orchestrator response with cards
 */
export async function sendMessage(
  message: string,
  sessionId: string
): Promise<OrchestratorResponse> {
  console.log('[Orchestrator Client] Sending message:', message);
  
  const res = await fetch(`${ORCHESTRATOR_BASE}/orchestrator/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Send a card action (button click) to the orchestrator
 * @param action - Action identifier from card button
 * @param payload - Action payload (provider, program, etc.)
 * @param sessionId - Unique session identifier
 * @returns Promise resolving to next orchestrator response
 */
export async function sendAction(
  action: string,
  payload: any,
  sessionId: string
): Promise<OrchestratorResponse> {
  console.log('[Orchestrator Client] Sending action:', action, payload);
  
  const res = await fetch(`${ORCHESTRATOR_BASE}/orchestrator/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, sessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
