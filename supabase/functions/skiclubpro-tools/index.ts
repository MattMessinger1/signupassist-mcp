import { invokeMCPToolDirect } from '../_shared/mcpClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tool, args } = await req.json();
    
    console.log(`skiclubpro-tools invoked with tool: ${tool}`, { args });

    // Map the tool to the correct MCP server call
    let result;
    
    switch (tool) {
      case 'scp:find_programs':
      case 'scp.find_programs':
        result = await invokeMCPToolDirect('scp.find_programs', args);
        break;
      case 'scp:login':
      case 'scp.login':
        result = await invokeMCPToolDirect('scp.login', args);
        break;
      case 'scp:register':
      case 'scp.register':
        result = await invokeMCPToolDirect('scp.register', args);
        break;
      case 'scp:pay':
      case 'scp.pay':
        result = await invokeMCPToolDirect('scp.pay', args);
        break;
      case 'scp:discover_fields':
      case 'scp.discover_fields':
        result = await invokeMCPToolDirect('scp.discover_fields', args);
        break;
      default:
        console.error(`Unknown SkiClubPro tool: ${tool}`);
        return new Response(
          JSON.stringify({ error: `Unknown tool: ${tool}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`skiclubpro-tools ${tool} result:`, result);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in skiclubpro-tools function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});