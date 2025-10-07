/**
 * Direct MCP client for Railway deployment
 * Forces all discovery requests to go through Railway MCP server (no local fallback)
 */

const MCP_BASE = import.meta.env.VITE_MCP_BASE_URL;
if (!MCP_BASE) {
  throw new Error("VITE_MCP_BASE_URL missing - must point to Railway MCP server");
}

export async function mcpDiscover(body: Record<string, any>) {
  const run_id = body.run_id ?? crypto.randomUUID();
  
  try {
    const res = await fetch(`${MCP_BASE}/tools/call`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Run-Id": run_id,
      },
      body: JSON.stringify({
        tool: "scp.discover_required_fields",
        args: {
          ...body,
          mode: body.mode || 'full', // Support prerequisites_only mode
        },
      }),
    });
    
    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
      console.error('[MCP] Discovery failed:', res.status, data);
      return { 
        data: { success: false, error: data.error || `HTTP ${res.status}` }, 
        run_id, 
        status: res.status 
      };
    }
    
    return { data, run_id, status: res.status };
  } catch (error) {
    console.error('[MCP] Network error:', error);
    return {
      data: { success: false, error: error instanceof Error ? error.message : 'Network error' },
      run_id,
      status: 0,
    };
  }
}
