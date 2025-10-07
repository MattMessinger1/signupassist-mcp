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

      // Log audit trail if not skipped and we have required IDs
      if (!skipAudit && (mandate_id || plan_execution_id)) {
        let safePlanExecutionId = plan_execution_id;
        
        if (!safePlanExecutionId || safePlanExecutionId === "") {
          console.log("DEBUG replacing empty or falsy plan_execution_id with null before audit");
          safePlanExecutionId = null;
        }

        await logMCPAudit({
          tool,
          args,
          result,
          mandate_id,
          plan_execution_id: safePlanExecutionId
        });
      } else if (skipAudit) {
        console.log("DEBUG skipAudit=true — audit logging intentionally skipped for tool:", tool);
      }

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
    
    // Log failed audit trail if not skipped and we have required IDs
    if (!skipAudit && (mandate_id || plan_execution_id)) {
      let safePlanExecutionId = plan_execution_id;
      if (!safePlanExecutionId) {
        console.log("DEBUG plan_execution_id falsy in catch block, forcing null before failed audit");
        safePlanExecutionId = null;
      }

      await logMCPAudit({
        tool,
        args,
        result: { error: error instanceof Error ? error.message : 'Unknown error' },
        mandate_id,
        plan_execution_id: safePlanExecutionId,
        decision: 'denied'
      });
    } else if (skipAudit) {
      console.log("DEBUG skipAudit=true — failed audit logging also skipped for tool:", tool);
    }
    
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

async function logMCPAudit({
  tool,
  args,
  result,
  mandate_id,
  plan_execution_id,
  decision = 'allowed'
}: {
  tool: string;
  args: any;
  result: any;
  mandate_id?: string;
  plan_execution_id?: string | null;
  decision?: 'allowed' | 'denied';
}): Promise<void> {
  try {
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const auditData = {
      tool,
      args_json: args,
      result_json: result,
      args_hash: await generateHash(JSON.stringify(args)),
      result_hash: await generateHash(JSON.stringify(result)),
      decision,
      mandate_id: mandate_id || crypto.randomUUID(), // Fallback if not provided
      ...(plan_execution_id ? { plan_execution_id } : {}) // Only include if it has a value
    };

    const { error: auditError } = await serviceSupabase
      .from('mcp_tool_calls')
      .insert(auditData);

    if (auditError) {
      console.error('Failed to log MCP audit:', auditError);
    } else {
      console.log(`Logged MCP audit for tool: ${tool}`);
    }
  } catch (error) {
    console.error('Error logging MCP audit:', error);
  }
}

async function generateHash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}