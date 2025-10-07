import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SignJWT, importJWK } from 'https://esm.sh/jose@5.2.4';
import { invokeMCPTool } from '../_shared/mcpClient.ts';
import { generateFormFingerprint } from '../_shared/fingerprint.ts';
import { logStructuredError, sanitizeError } from '../_shared/errors.ts';
import { verifyDecryption, sanitizeCredentialsForLog, CredentialError } from '../_shared/account-credentials.ts';

// Mapping utilities
function mapValues<T, U>(obj: { [key: string]: T }, fn: (val: T, key: string) => U): { [key: string]: U } {
  const newObj: { [key: string]: U } = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      newObj[key] = fn(obj[key], key);
    }
  }
  return newObj;
}

function remap<T>(obj: { [key: string]: T }, keyMap: { [key: string]: string }): { [key: string]: T } {
  return mapValues(keyMap, (newKey, oldKey) => obj[oldKey]);
}

function filterNulls<T>(obj: { [key: string]: T | null | undefined }): { [key: string]: T } {
  const newObj: { [key: string]: T } = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const val = obj[key];
      if (val != null) {
        newObj[key] = val;
      }
    }
  }
  return newObj;
}

function normText(s?: string) {
  return (s || "").trim().replace(/\s+/g, " ");
}

function cleanLabel(raw: string): string {
  if (!raw) return "";
  let label = raw.trim();
  label = label.replace(/^(nordic\s*kids|program\s*\d+|registration)\s*/i, "");
  label = label.replace(/^[:-\s]+|[:-\s]+$/g, "");
  label = label.replace(/\s{2,}/g, " ");
  label = label.replace(/\s*-\s*/g, ": ");
  label = label.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  label = label.replace(/\b(Of|And|For|To|In|On|At|With|A|An|The)\b/g, (m) => m.toLowerCase());
  return label.trim();
}

function dedupe<T>(arr: T[]) { return Array.from(new Set(arr)); }

function stripPlaceholders(arr: string[]) {
  return arr.filter(o =>
    o &&
    !/^(-\s*)?select\s*-?$/i.test(o) &&
    !/^choose|pick/i.test(o) &&
    o !== "_none"
  );
}

function stripTrailingPrice(arr: string[]) {
  return arr.map(o => o.replace(/\s*(\$\s*\d+(?:\.\d{2})?)\s*$/,"").trim());
}

function normalizeOptions(opts: any): string[] | undefined {
  if (!opts) return undefined;
  let out: string[] = [];
  if (Array.isArray(opts)) {
    out = opts.map((o: any) =>
      typeof o === "string" ? normText(o)
        : typeof o === "object" ? normText(o.label || o.text || o.value)
        : ""
    ).filter(Boolean);
  } else if (typeof opts === "object") {
    out = Object.values(opts).map(v => normText(String(v)));
  }
  out = stripPlaceholders(out);
  out = stripTrailingPrice(out);
  out = out.map(o => cleanLabel(o));
  out = dedupe(out);
  return out.length ? out : undefined;
}

function inferType(f: any): "text"|"number"|"date"|"select"|"radio"|"checkbox"|"textarea" {
  const t = (f.type || f.inputType || f.widget || f.control || f.tagName || "").toLowerCase();
  if (t.includes("select") || (Array.isArray(f.options) && f.options.length)) return "select";
  if (t.includes("radio")) return "radio";
  if (t.includes("checkbox")) return "checkbox";
  if (t.includes("textarea")) return "textarea";
  if (t.includes("number")) return "number";
  if (t.includes("date")) return "date";
  return "text";
}

function shouldSkip(f: any): boolean {
  const id = (f.id || "").toLowerCase();
  const label = (f.label || "").toLowerCase();
  if (id.startsWith("anon_")) return true;
  if (/participant/.test(id) || /participant/.test(label)) return true;
  if (/captcha|coupon|discount|code/.test(id + " " + label)) return true;
  if (f.hidden === true || f.visible === false) return true;
  return false;
}

function mapFieldsToProgramQuestions(fields: any[]): any[] {
  return fields
    .filter(f => !shouldSkip(f))
    .map(f => {
      const type = inferType(f);
      const options = normalizeOptions(f.options);
      return {
        id: f.id,
        label: cleanLabel(f.label || f.id),
        type,
        required: !!f.required,
        options,
        description: f.description,
        dependsOn: f.visibleWhen?.dependsOn,
        showWhen: f.visibleWhen?.value,
      };
    })
    .filter(q =>
      q.type !== "text" ? true : q.required === true
    );
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  program_ref: string;
  credential_id: string;
  child_name?: string;
  mode?: 'full' | 'prerequisites_only';
}

// Background discovery function
async function runDiscoveryInBackground(jobId: string, requestBody: RequestBody, authHeader: string) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Update job status to running
    await supabase
      .from('discovery_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', jobId);

    console.log(`[Job ${jobId}] Starting background discovery...`);

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) throw new Error('User not found');

    const { program_ref, credential_id, child_name, mode } = requestBody;

    // Load and decrypt credentials
    const { data: credentialData, error: credError } = await supabase.functions.invoke('cred-get', {
      headers: { Authorization: authHeader },
      body: { id: credential_id }
    });

    if (credError || !credentialData) throw new Error('Credential decryption failed');
    verifyDecryption(credentialData);

    // Generate mandate
    const mandate_id = crypto.randomUUID();
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
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

    const signingKey = Deno.env.get('MANDATE_SIGNING_KEY');
    if (!signingKey) throw new Error('MANDATE_SIGNING_KEY not set');

    const keyBytes = Uint8Array.from(atob(signingKey), c => c.charCodeAt(0));
    const jwk = {
      kty: 'oct',
      k: btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
    };
    const secret = await importJWK(jwk, 'HS256');

    const jws = await new SignJWT(mandatePayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setNotBefore(validFrom)
      .setIssuer('signupassist-platform')
      .setAudience('signupassist-mcp')
      .setExpirationTime(validUntil)
      .sign(secret);

    await supabase.from('mandates').insert({
      id: mandate_id,
      user_id: user.id,
      provider: 'skiclubpro',
      scope: ['scp:read:listings'],
      program_ref,
      max_amount_cents: 0,
      valid_from: mandatePayload.valid_from,
      valid_until: mandatePayload.valid_until,
      credential_type: 'jws',
      jws_compact: jws,
      status: 'active'
    });

    // Get warm hints
    const formFingerprint = await generateFormFingerprint(`${program_ref}|${credential_id}`);
    
    const { data: prereqHints } = await supabase.rpc("get_best_hints", {
      p_provider: "skiclubpro",
      p_program: `${program_ref}_prereqs`,
      p_stage: "prerequisites",
    });
    const warmHintsPrereqs = prereqHints?.hints ?? {};

    const { data: programHints } = await supabase.rpc("get_best_hints", {
      p_provider: "skiclubpro",
      p_program: program_ref,
      p_stage: "program",
    });
    const warmHintsProgram = programHints?.hints ?? {};

    // Call MCP discovery
    const userJwt = authHeader.replace('Bearer ', '');
    const result = await invokeMCPTool("scp.discover_required_fields", {
      program_ref,
      mandate_id,
      credential_id,
      user_jwt: userJwt,
      mode: mode || 'full',
      warm_hints_prereqs: warmHintsPrereqs,
      warm_hints_program: warmHintsProgram,
      child_name: child_name || ''
    }, {
      mandate_id,
      skipAudit: true
    });

    console.log(`[Job ${jobId}] Discovery completed:`, result);

    // Persist discovery runs
    if (result?.prerequisite_checks && result.prerequisite_checks.length > 0) {
      await supabase.rpc("upsert_discovery_run", {
        p_provider: "skiclubpro",
        p_program: `${program_ref}_prereqs`,
        p_fingerprint: formFingerprint,
        p_stage: "prerequisites",
        p_errors: JSON.stringify(result.prerequisite_checks),
        p_meta: JSON.stringify({
          status: result.prerequisite_status,
          loopCount: result.metadata?.prerequisitesLoops ?? 0,
          checks: result.prerequisite_checks.map((c: any) => ({ id: c.id, status: c.status }))
        }),
        p_run_conf: result.metadata?.prerequisitesConfidence ?? 0.8,
        p_run_id: crypto.randomUUID(),
      });
    }
    
    if (result?.program_questions && result.program_questions.length > 0) {
      await supabase.rpc("upsert_discovery_run", {
        p_provider: "skiclubpro",
        p_program: program_ref,
        p_fingerprint: formFingerprint,
        p_stage: "program",
        p_errors: JSON.stringify(result.program_questions),
        p_meta: JSON.stringify({
          formWatchOpensAt: result?.formWatchOpensAt ?? null,
          formWatchClosesAt: result?.formWatchClosesAt ?? null,
          loopCount: result.metadata?.programLoops ?? null,
          usedWarmHints: Object.keys(warmHintsProgram).length > 0,
        }),
        p_run_conf: result?.branches ? 0.9 : 0.6,
        p_run_id: crypto.randomUUID(),
      });
    }

    // Map and store results
    const programQuestions = mapFieldsToProgramQuestions(result?.program_questions || []);
    const discoveredSchema = programQuestions.length > 0 ? {
      program_ref,
      branches: [],
      common_questions: programQuestions,
      discoveryCompleted: true
    } : null;

    // Update job as completed
    await supabase
      .from('discovery_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        prerequisite_checks: result?.prerequisite_checks || null,
        program_questions: programQuestions || null,
        discovered_schema: discoveredSchema,
        metadata: {
          prerequisite_status: result?.prerequisite_status,
          metadata: result?.metadata
        }
      })
      .eq('id', jobId);

    console.log(`[Job ${jobId}] Successfully completed and saved`);

  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);
    
    await supabase
      .from('discovery_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication Required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Session Expired' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: RequestBody = await req.json();
    const { program_ref, credential_id, child_name, mode } = body;

    if (!program_ref || !credential_id) {
      return new Response(
        JSON.stringify({ error: 'Missing program_ref or credential_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing pending/running job for this user+program
    const { data: existingJob } = await supabase
      .from('discovery_jobs')
      .select('*')
      .eq('user_id', user.id)
      .eq('program_ref', program_ref)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If there's already a job running/pending, return that job ID
    if (existingJob) {
      console.log(`Returning existing job ${existingJob.id} (status: ${existingJob.status})`);
      return new Response(
        JSON.stringify({ 
          job_id: existingJob.id,
          status: existingJob.status,
          message: 'Discovery already in progress. Returning existing job.'
        }),
        { 
          status: 202, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create new discovery job record
    const { data: job, error: jobError } = await supabase
      .from('discovery_jobs')
      .insert({
        user_id: user.id,
        program_ref,
        credential_id,
        child_name: child_name || null,
        mode: mode || 'full',
        status: 'pending'
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error('Failed to create discovery job:', jobError);
      return new Response(
        JSON.stringify({ error: 'Failed to create discovery job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Created discovery job: ${job.id}`);

    // Start background processing
    EdgeRuntime.waitUntil(
      runDiscoveryInBackground(job.id, body, authHeader)
    );

    // Return job ID immediately
    return new Response(
      JSON.stringify({ 
        job_id: job.id,
        status: 'pending',
        message: 'Discovery job started. Poll for results.'
      }),
      { 
        status: 202, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
