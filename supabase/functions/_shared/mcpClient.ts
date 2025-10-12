import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

export interface MCPToolCall {
  tool: string;
  args: any;
  mandate_id?: string;
  plan_execution_id?: string;
}

export interface MCPAuditOptions {
  mandate_id?: string;
  plan_execution_id?: string | null;
  skipAudit?: boolean;
}

export async function invokeMCPTool(
  tool: string, 
  args: any, 
  options: MCPAuditOptions = {}
): Promise<any> {
  const { mandate_id, plan_execution_id, skipAudit = false } = options;
  
  console.log(`Invoking MCP tool: ${tool}`, { args, mandate_id, plan_execution_id });

  try {
    // Call the deployed Railway MCP server directly
    const mcpServerUrl = Deno.env.get('MCP_SERVER_URL') || 'https://signupassist-mcp-production.up.railway.app';
    
    console.log(`Calling MCP server at: ${mcpServerUrl}`);
    
    // Build args - completely exclude plan_execution_id when skipAudit is true
    const requestArgs = {
      ...args,
      mandate_id
    };
    
    // Only add plan_execution_id if we're NOT skipping audit AND it's a valid value
    if (!skipAudit && plan_execution_id && plan_execution_id !== "") {
      requestArgs.plan_execution_id = plan_execution_id;
      console.log(`DEBUG adding plan_execution_id to request: ${plan_execution_id}`);
    } else if (skipAudit) {
      console.log(`DEBUG skipAudit=true — completely omitting plan_execution_id from MCP request`);
    }
    
    console.log(`MCP request body being sent:`, JSON.stringify({
      tool,
      args: requestArgs
    }, null, 2));

    // Set timeout for long-running MCP operations (5 minutes for discovery)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 seconds (5 minutes)

    try {
      const response = await fetch(`${mcpServerUrl}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool,
          args: requestArgs
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`MCP server returned ${response.status}:`, errorText);
        throw new Error(`MCP Server Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('MCP server request timed out after 5 minutes. The discovery process is taking too long.');
      }
      throw error;
    }

  } catch (error) {
    console.error(`MCP tool ${tool} failed:`, error);
    throw error;
  }
}

export async function invokeMCPToolDirect(tool: string, args: any): Promise<any> {
  const mcpServerUrl = Deno.env.get("MCP_SERVER_URL");
  
  if (!mcpServerUrl) {
    throw new Error("MCP_SERVER_URL environment variable not configured");
  }

  console.log(`Invoking MCP tool directly: ${tool}`, { args });

  const res = await fetch(`${mcpServerUrl}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`MCP Server Error: ${res.status} - ${errorText || 'Direct server communication failed'}`);
  }

  return res.json();
}
