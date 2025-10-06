import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  provider_slug: string;
  program_key: string;
  stage: "prerequisites" | "program";
}

interface HintsResponse {
  hints: Record<string, unknown>;
  confidence?: number;
  samples_count?: number;
  fingerprint?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();
    const { provider_slug, program_key, stage } = body;

    // Validate input
    if (!provider_slug || !program_key || !stage) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: provider_slug, program_key, stage",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (stage !== "prerequisites" && stage !== "program") {
      return new Response(
        JSON.stringify({
          error: "Invalid stage. Must be 'prerequisites' or 'program'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Fetching hints for ${provider_slug}/${program_key}/${stage}`);

    // Call get_best_hints RPC
    const { data, error } = await supabase.rpc("get_best_hints", {
      p_provider: provider_slug,
      p_program: program_key,
      p_stage: stage,
    });

    if (error) {
      console.error("RPC error:", error);
      throw error;
    }

    // Handle miss (empty object returned by RPC)
    if (!data || Object.keys(data).length === 0) {
      console.log("No hints found - returning empty hints object");
      return new Response(
        JSON.stringify({
          hints: {},
        } as HintsResponse),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Extract and return hints data
    const response: HintsResponse = {
      hints: data.hints || {},
      confidence: data.confidence,
      samples_count: data.samples_count,
      fingerprint: data.fingerprint,
    };

    console.log(`Hints found: ${Object.keys(response.hints).length} fields, confidence: ${response.confidence}`);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in get-discovery-hints:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
