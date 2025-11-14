/**
 * Orchestrator Client
 * 
 * Client-side API for communicating with the AI Orchestrator backend.
 * Handles both text messages and card action clicks.
 */

const ORCHESTRATOR_BASE = import.meta.env.VITE_MCP_BASE_URL;

if (!ORCHESTRATOR_BASE) {
  console.error('[Orchestrator] VITE_MCP_BASE_URL not configured. Please set it in your .env file.');
}

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
 * @param userLocation - Optional GPS coordinates for location-based filtering
 * @param category - Optional activity category (lessons, camps, races) for targeted search
 * @param childAge - Optional child age for age-based filtering
 * @returns Promise resolving to orchestrator response with cards
 */
export async function sendMessage(
  message: string,
  sessionId: string,
  userLocation?: {lat: number, lng: number},
  userJwt?: string,
  category?: string,
  childAge?: number,
  provider?: string
): Promise<OrchestratorResponse> {
  if (!ORCHESTRATOR_BASE) {
    throw new Error('MCP Server URL not configured. Please set VITE_MCP_BASE_URL in your .env file.');
  }
  
  console.log('[Orchestrator Client] Sending message:', message, { 
    hasLocation: !!userLocation, 
    hasJwt: !!userJwt,
    category,
    childAge,
    provider
  });
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mandate-JWS': import.meta.env.VITE_MANDATE_JWS_DEV || '__DEV_BYPASS__'
  };
  
  if (userJwt) {
    headers['Authorization'] = `Bearer ${userJwt}`;
  }
  
  const res = await fetch(`${ORCHESTRATOR_BASE}/orchestrator/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ 
      message, 
      sessionId, 
      userLocation, 
      userJwt,
      category,
      childAge,
      provider
    }),
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
  sessionId: string,
  userJwt?: string
): Promise<OrchestratorResponse> {
  if (!ORCHESTRATOR_BASE) {
    throw new Error('MCP Server URL not configured. Please set VITE_MCP_BASE_URL in your .env file.');
  }
  
  console.log('[Orchestrator Client] Sending action:', action, payload, { hasJwt: !!userJwt });
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mandate-JWS': import.meta.env.VITE_MANDATE_JWS_DEV || '__DEV_BYPASS__'
  };
  
  if (userJwt) {
    headers['Authorization'] = `Bearer ${userJwt}`;
  }
  
  const res = await fetch(`${ORCHESTRATOR_BASE}/orchestrator/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, payload, sessionId, userJwt }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Override the system prompt for a session (tone training)
 * @param sessionId - Session identifier
 * @param newPrompt - New system prompt text
 * @returns Promise resolving to success response
 */
export async function overridePrompt(
  sessionId: string,
  newPrompt: string
): Promise<{ success: boolean; message: string }> {
  if (!ORCHESTRATOR_BASE) {
    throw new Error('MCP Server URL not configured. Please set VITE_MCP_BASE_URL in your .env file.');
  }
  
  console.log('[Orchestrator Client] Overriding prompt for session:', sessionId);
  
  const res = await fetch(`${ORCHESTRATOR_BASE}/api/override-prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sessionId, newPrompt }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
