import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { validateSchemaConsistency, getValidationHeaders } from '../_shared/validate-schema-consistency.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Schema validation endpoint
 * 
 * Validates consistency of database schema across all tables
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[SchemaValidation] Starting validation check...');

    const result = await validateSchemaConsistency();

    const responseHeaders = {
      ...corsHeaders,
      ...getValidationHeaders(result),
      'Content-Type': 'application/json',
    };

    return new Response(
      JSON.stringify(result, null, 2),
      { 
        status: result.valid ? 200 : 422,
        headers: responseHeaders
      }
    );

  } catch (error) {
    console.error('[SchemaValidation] Error:', error);
    
    return new Response(
      JSON.stringify({ 
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
