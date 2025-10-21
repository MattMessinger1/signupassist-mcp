/**
 * MCP Client for Chat Test Harness
 * Communicates with SignupAssist MCP server for tool execution
 */

const MCP_BASE = import.meta.env.VITE_MCP_BASE_URL || 'http://localhost:8080';
const MCP_TOKEN = import.meta.env.VITE_MCP_ACCESS_TOKEN;

export interface MCPTool {
  name: string;
  description: string;
}

export interface MCPCallResult {
  success: boolean;
  data?: any;
  error?: string;
  [key: string]: any;
}

/**
 * List all available MCP tools
 */
export async function listMCPTools(): Promise<MCPTool[]> {
  try {
    const res = await fetch(`${MCP_BASE}/tools`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      console.error('[MCP] Failed to list tools:', res.status);
      return [];
    }

    const data = await res.json();
    return data.tools || [];
  } catch (error) {
    console.error('[MCP] Error listing tools:', error);
    return [];
  }
}

/**
 * Call an MCP tool with arguments
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, any> = {}
): Promise<MCPCallResult> {
  const runId = crypto.randomUUID();

  console.log(`[MCP] Calling tool: ${toolName}`, args);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Run-Id': runId,
    };

    // Add auth token if available
    if (MCP_TOKEN) {
      headers['Authorization'] = `Bearer ${MCP_TOKEN}`;
    }

    const res = await fetch(`${MCP_BASE}/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool: toolName,
        args,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`[MCP] Tool call failed:`, res.status, data);
      return {
        success: false,
        error: data.error || `HTTP ${res.status}`,
        data,
      };
    }

    console.log(`[MCP] Tool call success:`, data);
    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error('[MCP] Network error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
 * Convenience methods for common tool calls
 */

export async function mcpLogin(email: string, password: string, orgRef: string) {
  return callMCPTool('scp:login', {
    email,
    password,
    org_ref: orgRef,
  });
}

export async function mcpFindPrograms(orgRef: string, query?: string) {
  return callMCPTool('scp:find_programs', {
    org_ref: orgRef,
    query,
  });
}

export async function mcpCheckPrerequisites(orgRef: string, programRef?: string) {
  return callMCPTool('scp:check_prerequisites', {
    org_ref: orgRef,
    program_ref: programRef,
  });
}

export async function mcpRegister(sessionRef: string, programRef: string, childId: string) {
  return callMCPTool('scp:register', {
    session_ref: sessionRef,
    program_ref: programRef,
    child_id: childId,
  });
}

export async function mcpPay(sessionRef: string, registrationRef: string, amountCents: number) {
  return callMCPTool('scp:pay', {
    session_ref: sessionRef,
    registration_ref: registrationRef,
    amount_cents: amountCents,
  });
}

/**
 * Initialize MCP client and verify connection
 */
export async function initializeMCP(): Promise<boolean> {
  console.log('[MCP] Initializing client...');
  console.log('[MCP] Base URL:', MCP_BASE);
  console.log('[MCP] Token configured:', !!MCP_TOKEN);

  const tools = await listMCPTools();
  
  if (tools.length > 0) {
    console.log('[MCP] Connected successfully. Available tools:', tools.map(t => t.name).join(', '));
    return true;
  } else {
    console.warn('[MCP] No tools available. Server may be unreachable.');
    return false;
  }
}
