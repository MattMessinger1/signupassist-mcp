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

  console.log(`[MCP] ===== TOOL CALL START =====`);
  console.log(`[MCP] Tool: ${toolName}`);
  console.log(`[MCP] Args:`, args);
  console.log(`[MCP] Run ID: ${runId}`);
  console.log(`[MCP] Base URL: ${MCP_BASE}`);
  console.log(`[MCP] Auth Token: ${MCP_TOKEN ? MCP_TOKEN.slice(0, 4) + '****' : 'MISSING'}`);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Run-Id': runId,
    };

    if (MCP_TOKEN) {
      headers['Authorization'] = `Bearer ${MCP_TOKEN}`;
      console.log(`[MCP] Auth header added: Bearer ${MCP_TOKEN.slice(0, 4)}****`);
    } else {
      console.warn('[MCP] WARNING: No auth token configured!');
    }

    const requestBody = {
      tool: toolName,
      args,
    };
    console.log(`[MCP] Request body:`, JSON.stringify(requestBody, null, 2));

    const res = await fetch(`${MCP_BASE}/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    console.log(`[MCP] Response status: ${res.status}`);
    console.log(`[MCP] Response headers:`, Object.fromEntries(res.headers.entries()));

    const data = await res.json().catch(() => ({}));
    console.log(`[MCP] Response data:`, data);

    if (!res.ok) {
      console.error(`[MCP] Tool call failed:`, res.status, data);
      console.log(`[MCP] ===== TOOL CALL FAILED =====`);
      return {
        success: false,
        error: data.error || `HTTP ${res.status}`,
        data,
      };
    }

    console.log(`[MCP] Tool call success!`);
    console.log(`[MCP] ===== TOOL CALL SUCCESS =====`);
    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error('[MCP] Network error:', error);
    console.log(`[MCP] ===== TOOL CALL ERROR =====`);
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
 * Health check and diagnostics for MCP connection
 */
export interface MCPHealthCheckResult {
  ok: boolean;
  details: {
    health?: string;
    toolCount?: number;
    tools?: MCPTool[];
    manifest?: any;
    error?: string;
  };
}

export async function checkMCPHealth(): Promise<MCPHealthCheckResult> {
  console.log('[MCP Health] ===== STARTING HEALTH CHECK =====');
  console.log('[MCP Health] Base URL:', MCP_BASE);
  console.log('[MCP Health] Token configured:', !!MCP_TOKEN);
  
  try {
    // 1. Health endpoint (no auth required)
    console.log('[MCP Health] Checking /health endpoint...');
    const healthRes = await fetch(`${MCP_BASE}/health`);
    const healthData = await healthRes.text();
    console.log('[MCP Health] /health response:', healthData, `(${healthRes.status})`);
    
    // 2. Manifest endpoint (no auth required)
    console.log('[MCP Health] Checking /mcp/manifest.json endpoint...');
    const manifestRes = await fetch(`${MCP_BASE}/mcp/manifest.json`);
    const manifestData = await manifestRes.json().catch(() => ({}));
    console.log('[MCP Health] Manifest tools count:', manifestData.tools?.length || 0);
    console.log('[MCP Health] Manifest tools:', manifestData.tools?.map((t: any) => t.name).join(', '));
    
    // 3. Tools list endpoint (no auth required)
    console.log('[MCP Health] Checking /tools endpoint...');
    const toolsRes = await fetch(`${MCP_BASE}/tools`);
    const toolsData = await toolsRes.json().catch(() => ({}));
    console.log('[MCP Health] Available tools count:', toolsData.tools?.length || 0);
    console.log('[MCP Health] Available tools:', toolsData.tools?.map((t: any) => t.name).join(', '));
    
    const allOk = healthRes.ok && manifestRes.ok && toolsRes.ok;
    console.log('[MCP Health] ===== HEALTH CHECK', allOk ? 'PASSED' : 'FAILED', '=====');
    
    return {
      ok: allOk,
      details: {
        health: healthData,
        toolCount: toolsData.tools?.length || 0,
        tools: toolsData.tools || [],
        manifest: manifestData,
      }
    };
  } catch (error) {
    console.error('[MCP Health] Connection failed:', error);
    console.log('[MCP Health] ===== HEALTH CHECK ERROR =====');
    return { 
      ok: false, 
      details: { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      } 
    };
  }
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
