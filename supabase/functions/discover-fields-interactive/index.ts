import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SignJWT, importJWK } from 'https://esm.sh/jose@5.2.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';
import { generateFormFingerprint } from '../_shared/fingerprint.ts';
import { toIsoStringSafe } from '../_shared/utils.ts';
import { logStructuredError, sanitizeError } from '../_shared/errors.ts';
import { verifyDecryption, sanitizeCredentialsForLog, CredentialError } from '../_shared/account-credentials.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  program_ref: string;
  credential_id: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Check authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication Required: Please log in to discover program fields' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Session Expired: Please log in again to continue' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log("auth user id:", user.id);

    const body: RequestBody = await req.json();
    const { program_ref, credential_id } = body;

    // Validate required fields
    if (!program_ref || !credential_id) {
      console.error('Missing required fields:', { program_ref, credential_id });
      return new Response(
        JSON.stringify({ 
          error: 'Missing program_ref or credential_id',
          received: { program_ref, credential_id }
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Interactive field discovery for program ${program_ref}, credential ${credential_id}`);
    console.log('Payload received:', { program_ref, credential_id });

    // Load and decrypt the credential - wrap in try/catch for proper error handling
    let credentialData;
    try {
      const { data, error: credError } = await supabase.functions.invoke('cred-get', {
        headers: {
          Authorization: authHeader
        },
        body: { id: credential_id }
      });

      if (credError || !data) {
        throw new Error(credError?.message || 'Credential decryption failed');
      }

      credentialData = data;
      console.log('Credential successfully decrypted');

      // Verify decryption produced valid credentials
      try {
        verifyDecryption(credentialData);
        console.log('Credential validation passed:', sanitizeCredentialsForLog(credentialData));
        
        // Log successful validation
        await logStructuredError(supabase, {
          stage: 'token_validation',
          error: 'success',
          credential_id,
          program_ref,
          validationResult: 'passed'
        });
        
      } catch (validationError) {
        const isCredError = validationError instanceof CredentialError;
        const sanitizedError = sanitizeError(validationError);
        
        console.error('Token validation failed:', sanitizedError);
        console.error('Credential format:', sanitizeCredentialsForLog(credentialData));
        
        // Log validation failure
        await logStructuredError(supabase, {
          stage: 'token_validation',
          error: sanitizedError,
          credential_id,
          program_ref,
          credentialFormat: sanitizeCredentialsForLog(credentialData)
        });
        
        return new Response(
          JSON.stringify({ 
            error_code: 'TOKEN_VALIDATION_FAILED',
            error: 'Token validation failed',
            message: isCredError ? sanitizedError : 'Decrypted credentials are invalid. Please re-save your credentials.'
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

    } catch (credError) {
      const sanitizedError = sanitizeError(credError);
      console.error('Credential decryption failed:', sanitizedError);

      // Log structured error
      await logStructuredError(supabase, {
        stage: 'credential_decryption',
        error: sanitizedError,
        credential_id,
        program_ref
      });

      return new Response(
        JSON.stringify({ 
          error_code: 'CREDENTIAL_DECRYPTION_FAILED',
          error: 'Credential decryption failed',
          message: 'Unable to decrypt credentials. Please verify your credentials are properly saved.'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Generate mandate with JWS
    const mandate_id = crypto.randomUUID();
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const validFrom = new Date();
    
    const mandatePayload = {
      mandate_id,
      user_id: user.id,
      provider: 'skiclubpro',
      scopes: ['scp:read:listings'],
      program_ref,
      max_amount_cents: 0,
      valid_from: validFrom.toISOString(),
      valid_until: validUntil.toISOString(),
      credential_type: 'jws' as const,
    };

    console.log('Creating temporary mandate for field discovery:', mandatePayload);
    console.log("mandate payload keys:", Object.keys(mandatePayload));

    // Generate JWS token
    const signingKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!signingKey) {
      throw new Error('MANDATE_SIGNING_KEY environment variable is required');
    }

    // Decode the base64 signing key using Buffer-compatible method  
    const keyBytes = Uint8Array.from(atob(signingKey), c => c.charCodeAt(0));
    
    // Create JWK using consistent base64url encoding that matches MCP server
    const jwk = {
      kty: 'oct',
      k: btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
    };

    const secret = await importJWK(jwk, 'HS256');

    console.log("DEBUG validFrom:", validFrom.toISOString());
    console.log("DEBUG validUntil:", validUntil.toISOString());

    // Create and sign JWT with Date objects for proper time handling
    const jws = await new SignJWT(mandatePayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setNotBefore(validFrom)        // Pass Date instead of seconds
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(validUntil)  // Pass Date instead of seconds
      .sign(secret);

    // Insert mandate directly into database
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: mandateData, error: mandateError } = await supabaseService
      .from('mandates')
      .insert({
        id: mandate_id,
        user_id: user.id,
        provider: 'skiclubpro',
        scope: ['scp:read:listings'],  // Use singular 'scope' to match DB column
        program_ref,
        max_amount_cents: 0,
        valid_from: mandatePayload.valid_from,
        valid_until: mandatePayload.valid_until,
        credential_type: 'jws',
        jws_compact: jws,
        status: 'active'
      })
      .select()
      .single();

    if (mandateError || !mandateData) {
      console.error('Failed to insert mandate:', mandateError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create mandate',
          details: mandateError?.message || 'Unknown error'
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    console.log(`Issued mandate ${mandate_id} for interactive field discovery`);
    console.log("mandate id returned:", mandateData?.id, "error:", mandateError);

    // Compute a stable fingerprint for this form URL using Web Crypto API
    const formFingerprint = await generateFormFingerprint(`${program_ref}|${credential_id}`);

    console.log("formFingerprint:", formFingerprint);

    // Try warming from existing discovery hints
    let warmHints = {};
    try {
      const { data: hintData } = await supabase.rpc("get_best_hints", {
        p_provider: "skiclubpro",
        p_program: program_ref,
        p_stage: "program",
      });
      warmHints = hintData?.hints ?? {};
      console.log("Loaded warmHints keys:", Object.keys(warmHints));
    } catch (err) {
      console.warn("No warm hints available or RPC missing:", err.message);
    }

    // Call the MCP provider tool for field discovery directly
    const userJwt = authHeader.replace('Bearer ', '');
    console.log("invoking MCP with mandate_id:", mandate_id, "credential_id:", credential_id);
    console.log("DEBUG interactive discovery: skipAudit=true, omitting plan_execution_id");
    
    const stageStart = Date.now();
    
    try {
      const result = await invokeMCPTool("scp.discover_required_fields", {
        program_ref,
        mandate_id,
        credential_id,
        user_jwt: userJwt,  // ✅ Forward user JWT for credential access
        warm_hints: warmHints  // 🧩 Pass warm hints to MCP tool for faster discovery
      }, {
        mandate_id,
        skipAudit: true   // ✅ no audit for discovery
      });

      console.log('Field discovery completed:', result);

      // Persist the discovery run for learning
      try {
        const errorsJson = JSON.stringify(result?.errors ?? []);
        const meta = {
          formWatchOpensAt: result?.formWatchOpensAt ?? null,
          formWatchClosesAt: result?.formWatchClosesAt ?? null,
          loopCount: result?.loopCount ?? null,
          usedWarmHints: Object.keys(warmHints).length > 0,
        };
        const runConfidence = result?.branches ? 0.9 : 0.6; // simple heuristic
        const runId = crypto.randomUUID();

        await supabase.rpc("upsert_discovery_run", {
          p_provider: "skiclubpro",
          p_program: program_ref,
          p_fingerprint: formFingerprint,
          p_stage: "program",
          p_errors: errorsJson,
          p_meta: JSON.stringify(meta),
          p_run_conf: runConfidence,
          p_run_id: runId,
        });
        console.log("Persisted discovery run:", runId, "confidence:", runConfidence);
      } catch (err) {
        console.error("Failed to persist discovery run:", err);
      }

      // Normalize MCP response to match frontend expectations
      const discoveredSchema = result?.branches ? {
        program_ref,
        branches: result.branches,
        common_questions: result.prerequisites || result.common_questions || []
      } : null;

      const response = {
        success: !!discoveredSchema,
        ...discoveredSchema,
        prerequisiteChecks: result?.prerequisiteChecks || [],
        // ✅ Normalize all date fields to ISO strings
        formWatchOpensAt: toIsoStringSafe(result?.formWatchOpensAt),
        formWatchClosesAt: toIsoStringSafe(result?.formWatchClosesAt),
        timestamp: new Date().toISOString()
      };

      console.log('Normalized response:', response);

      const elapsedMs = Date.now() - stageStart;
      console.log(`Discovery elapsed ${elapsedMs} ms`);

      return new Response(JSON.stringify(response), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      console.error("MCP call failed:", err);
      const error = err as any;
      
      // Extract diagnostics if available
      const errorResponse: any = {
        error: `Field Discovery Failed: ${error?.message || "Unable to discover form fields for this program"}`
      };
      
      if (error?.diagnostics) {
        errorResponse.diagnostics = error.diagnostics;
      }
      
      return new Response(
        JSON.stringify(errorResponse),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }


  } catch (error) {
    console.error('Error in discover-fields-interactive function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Field Discovery Error: ${error instanceof Error ? error.message : 'Unable to process field discovery request'}`
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});