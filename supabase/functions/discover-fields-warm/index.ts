import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Discovery configuration
const DISCOVERY_MAX_STAGE_SECONDS = parseInt(Deno.env.get("DISCOVERY_MAX_STAGE_SECONDS") || "60", 10);
const MAX_STAGE_SECONDS = Math.max(30, Math.min(120, isNaN(DISCOVERY_MAX_STAGE_SECONDS) ? 60 : DISCOVERY_MAX_STAGE_SECONDS));

interface FieldError {
  fieldKey: string;
  message: string;
  selectorHints: string[];
}

interface WarmHints {
  [fieldKey: string]: {
    selectorHints?: string[];
    messageSamples?: string[];
  };
}

interface DiscoveryInput {
  startUrl: string;
  provider_slug: string;
  program_key: string;
}

interface StageResult {
  [fieldKey: string]: {
    message: string;
    selectorHints: string[];
  };
}

// Utility: Compute SHA-256 hash
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Sanitize error messages (remove PII)
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  
  // Remove email addresses
  msg = msg.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/g, "[EMAIL]");
  
  // Remove phone numbers
  msg = msg.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[PHONE]");
  msg = msg.replace(/\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, "[PHONE]");
  
  // Remove credit card numbers (13-19 digits)
  msg = msg.replace(/\d{13,19}/g, "[CC]");
  
  return msg;
}

// Compute form fingerprint from DOM structure
async function computeFormFingerprint(url: string, domSignature: string[]): Promise<string> {
  const urlObj = new URL(url);
  const path = urlObj.pathname; // no query params
  const sortedSignature = domSignature.sort().join("|");
  const combined = `${path}::${sortedSignature}`;
  return await sha256(combined);
}

// Log structured events
function logEvent(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
}

// Mock discovery engine (simplified for illustration)
async function runDiscoveryStage(
  stage: "prerequisites" | "program",
  warmHints: WarmHints,
  maxSeconds: number
): Promise<{ errors: FieldError[]; meta: Record<string, unknown> }> {
  const startTime = Date.now();
  const errors: FieldError[] = [];
  const iterations: number[] = [];
  const submitPaths: string[] = [];
  
  logEvent({ stage, action: "stage_start", warmHints: Object.keys(warmHints), maxSeconds });
  
  // Simulate discovery iterations (max 10 or until timeout)
  for (let iter = 1; iter <= 10; iter++) {
    const iterStart = Date.now();
    
    // Check timeout
    if ((Date.now() - startTime) / 1000 > maxSeconds) {
      logEvent({ stage, iter, action: "timeout", elapsedMs: Date.now() - startTime });
      break;
    }
    
    logEvent({ stage, iter, action: "iteration_start" });
    
    // Simulate field discovery with warm hints
    // In real implementation, this would:
    // 1. Use warmHints.selectorHints to find fields faster
    // 2. naiveAutofill() - fill fields, prefer $0 options for selects matching rent/addon patterns
    // 3. trySubmit() - avoid buttons matching /(pay|purchase|checkout|confirm|place order)/i
    // 4. collectErrors() - gather :invalid, [aria-invalid], .error, [role=alert] elements
    
    // Mock error collection with sanitization
    if (iter === 3 && stage === "prerequisites") {
      errors.push({
        fieldKey: "child_name",
        message: sanitizeErrorMessage("Child name is required"),
        selectorHints: ["input[name='childName']", "#child-name", "[aria-label='Child Name']"],
      });
    }
    
    if (iter === 5 && stage === "program") {
      errors.push({
        fieldKey: "skill_level",
        message: sanitizeErrorMessage("Please select a skill level"),
        selectorHints: ["select[name='skillLevel']", "#skill-level-select", "[aria-label='Skill Level']"],
      });
    }
    
    // Mock submit path tracking
    submitPaths.push(`/step-${iter}`);
    
    const iterDuration = Date.now() - iterStart;
    iterations.push(iterDuration);
    
    logEvent({ stage, iter, action: "iteration_complete", ms: iterDuration });
    
    // Stop conditions
    if (stage === "prerequisites") {
      // Check if URL or DOM indicates we've moved to program stage
      const programIndicator = iter >= 5;
      if (programIndicator) {
        logEvent({ stage, iter, action: "stop_condition_met", reason: "program_stage_detected" });
        break;
      }
    } else {
      // program stage: stop if no new errors for 2 consecutive iterations
      if (iter > 2 && errors.length === 0) {
        logEvent({ stage, iter, action: "stop_condition_met", reason: "no_errors_stable" });
        break;
      }
      
      // Or if we found success confirmation
      if (iter >= 7) {
        logEvent({ stage, iter, action: "stop_condition_met", reason: "confirmation_detected" });
        break;
      }
    }
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  const totalDuration = Date.now() - startTime;
  
  return {
    errors,
    meta: {
      iteration_count: iterations.length,
      total_duration_ms: totalDuration,
      iterations_ms: iterations,
      submit_paths: submitPaths,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const input: DiscoveryInput = await req.json();
    const { startUrl, provider_slug, program_key } = input;
    
    if (!startUrl || !provider_slug || !program_key) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: startUrl, provider_slug, program_key" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    logEvent({ action: "request_start", provider_slug, program_key, startUrl });
    
    // Generate unique run ID
    const run_id = crypto.randomUUID();
    
    // Compute form fingerprint (mock DOM signature for now)
    // In real implementation, extract this from actual DOM
    const mockDomSignature = [
      "input[name=childName]",
      "input[name=childDob]",
      "select[name=program]",
      "input[name=parentEmail]",
      "select[name=skillLevel]",
      "textarea[name=specialNeeds]",
    ];
    const form_fingerprint = await computeFormFingerprint(startUrl, mockDomSignature);
    
    logEvent({ action: "fingerprint_computed", run_id, form_fingerprint });
    
    // Results containers
    const results: {
      prerequisites: StageResult;
      program_questions: StageResult;
      meta: Record<string, unknown>;
    } = {
      prerequisites: {},
      program_questions: {},
      meta: {
        provider_slug,
        program_key,
        form_fingerprint,
        run_id,
        status: "success",
      },
    };
    
    // Stage 1: Prerequisites
    logEvent({ action: "stage_warm_read", stage: "prerequisites" });
    
    const { data: prereqHintsData, error: prereqHintsError } = await supabase.rpc("get_best_hints", {
      p_provider: provider_slug,
      p_program: program_key,
      p_stage: "prerequisites",
    });
    
    if (prereqHintsError) {
      logEvent({ action: "warm_hints_error", stage: "prerequisites", error: prereqHintsError.message });
    }
    
    const prereqWarmHints: WarmHints = prereqHintsData?.hints || {};
    
    logEvent({ 
      action: "warm_hints_loaded", 
      stage: "prerequisites",
      hint_count: Object.keys(prereqWarmHints).length,
    });
    
    const prereqResult = await runDiscoveryStage("prerequisites", prereqWarmHints, MAX_STAGE_SECONDS);
    
    // Convert errors to result format
    for (const error of prereqResult.errors) {
      results.prerequisites[error.fieldKey] = {
        message: error.message,
        selectorHints: error.selectorHints.slice(0, 3), // max 3
      };
    }
    
    // Persist prerequisites stage
    const prereqMeta = {
      hints: prereqWarmHints,
      ...prereqResult.meta,
    };
    
    const prereqConfidence = prereqResult.errors.length === 0 ? 0.9 : 0.5;
    
    const { data: prereqRunData, error: prereqRunError } = await supabase.rpc("upsert_discovery_run", {
      p_provider: provider_slug,
      p_program: program_key,
      p_fingerprint: form_fingerprint,
      p_stage: "prerequisites",
      p_errors: prereqResult.errors,
      p_meta: prereqMeta,
      p_run_conf: prereqConfidence,
      p_run_id: run_id,
    });
    
    if (prereqRunError) {
      logEvent({ action: "persist_error", stage: "prerequisites", error: prereqRunError.message });
    } else {
      logEvent({ action: "stage_persisted", stage: "prerequisites", run_id, discovery_run_id: prereqRunData });
    }
    
    // Stage 2: Program
    logEvent({ action: "stage_warm_read", stage: "program" });
    
    const { data: programHintsData, error: programHintsError } = await supabase.rpc("get_best_hints", {
      p_provider: provider_slug,
      p_program: program_key,
      p_stage: "program",
    });
    
    if (programHintsError) {
      logEvent({ action: "warm_hints_error", stage: "program", error: programHintsError.message });
    }
    
    const programWarmHints: WarmHints = programHintsData?.hints || {};
    
    logEvent({ 
      action: "warm_hints_loaded", 
      stage: "program",
      hint_count: Object.keys(programWarmHints).length,
    });
    
    const programResult = await runDiscoveryStage("program", programWarmHints, MAX_STAGE_SECONDS);
    
    // Convert errors to result format
    for (const error of programResult.errors) {
      results.program_questions[error.fieldKey] = {
        message: error.message,
        selectorHints: error.selectorHints.slice(0, 3),
      };
    }
    
    // Persist program stage
    const programMeta = {
      hints: programWarmHints,
      ...programResult.meta,
    };
    
    const programConfidence = programResult.errors.length === 0 ? 0.9 : 0.5;
    
    const { data: programRunData, error: programRunError } = await supabase.rpc("upsert_discovery_run", {
      p_provider: provider_slug,
      p_program: program_key,
      p_fingerprint: form_fingerprint,
      p_stage: "program",
      p_errors: programResult.errors,
      p_meta: programMeta,
      p_run_conf: programConfidence,
      p_run_id: run_id,
    });
    
    if (programRunError) {
      logEvent({ action: "persist_error", stage: "program", error: programRunError.message });
    } else {
      logEvent({ action: "stage_persisted", stage: "program", run_id, discovery_run_id: programRunData });
    }
    
    logEvent({ action: "request_complete", run_id, status: "success" });
    
    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (error) {
    logEvent({ 
      action: "error", 
      error: error instanceof Error ? error.message : "Unknown error",
    });
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        status: "error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
