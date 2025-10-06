import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MaintenanceResult {
  timestamp: string;
  hintsRefreshed: boolean;
  runsDeleted: number;
  hintConfidenceDecayed: number;
  errors: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const result: MaintenanceResult = {
    timestamp: new Date().toISOString(),
    hintsRefreshed: false,
    runsDeleted: 0,
    hintConfidenceDecayed: 0,
    errors: [],
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Starting discovery maintenance job...");

    // Step 1: Refresh best hints (no-op function, but call it for API consistency)
    try {
      await supabase.rpc("refresh_best_hints");
      result.hintsRefreshed = true;
      console.log("✓ Hints refresh completed (no-op)");
    } catch (error) {
      const message = `Hints refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(message);
      result.errors.push(message);
    }

    // Step 2: Prune old discovery_runs (older than 90 days, keep last 200 per provider/program/stage)
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Get all unique provider/program/stage combinations
      const { data: combinations, error: combosError } = await supabase
        .from("discovery_runs")
        .select("provider_slug, program_key, stage")
        .order("provider_slug")
        .order("program_key")
        .order("stage");

      if (combosError) throw combosError;

      // Deduplicate combinations
      const uniqueCombos = Array.from(
        new Set(
          (combinations || []).map((c) =>
            JSON.stringify([c.provider_slug, c.program_key, c.stage])
          )
        )
      ).map((s) => JSON.parse(s));

      let totalDeleted = 0;

      // For each combination, delete runs older than 90 days, keeping last 200
      for (const [provider_slug, program_key, stage] of uniqueCombos) {
        // Get IDs of runs to keep (last 200)
        const { data: runsToKeep, error: keepError } = await supabase
          .from("discovery_runs")
          .select("id")
          .eq("provider_slug", provider_slug)
          .eq("program_key", program_key)
          .eq("stage", stage)
          .order("created_at", { ascending: false })
          .limit(200);

        if (keepError) {
          console.error(`Error fetching runs to keep: ${keepError.message}`);
          continue;
        }

        const keepIds = (runsToKeep || []).map((r) => r.id);

        // Delete old runs not in the keep list
        const { data: deleted, error: deleteError } = await supabase
          .from("discovery_runs")
          .delete()
          .eq("provider_slug", provider_slug)
          .eq("program_key", program_key)
          .eq("stage", stage)
          .lt("created_at", ninetyDaysAgo.toISOString())
          .not("id", "in", `(${keepIds.join(",")})`)
          .select("id");

        if (deleteError) {
          console.error(`Error deleting runs: ${deleteError.message}`);
          result.errors.push(
            `Delete failed for ${provider_slug}/${program_key}/${stage}: ${deleteError.message}`
          );
          continue;
        }

        const deletedCount = deleted?.length || 0;
        if (deletedCount > 0) {
          totalDeleted += deletedCount;
          console.log(
            `Deleted ${deletedCount} runs for ${provider_slug}/${program_key}/${stage}`
          );
        }
      }

      result.runsDeleted = totalDeleted;
      console.log(`✓ Pruned ${totalDeleted} old discovery runs`);
    } catch (error) {
      const message = `Run pruning failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(message);
      result.errors.push(message);
    }

    // Step 3: Decay confidence in discovery_hints not hit in 45 days
    try {
      const fortyFiveDaysAgo = new Date();
      fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

      // Get hints not updated in 45 days
      const { data: staleHints, error: staleError } = await supabase
        .from("discovery_hints")
        .select("id, confidence")
        .lt("updated_at", fortyFiveDaysAgo.toISOString())
        .gt("confidence", 0);

      if (staleError) throw staleError;

      if (staleHints && staleHints.length > 0) {
        // Update confidence for each stale hint
        for (const hint of staleHints) {
          const newConfidence = Math.max(0, hint.confidence * 0.9); // Reduce by 10%, floor at 0

          const { error: updateError } = await supabase
            .from("discovery_hints")
            .update({ confidence: newConfidence })
            .eq("id", hint.id);

          if (updateError) {
            console.error(`Error updating hint ${hint.id}: ${updateError.message}`);
            result.errors.push(`Confidence update failed for hint ${hint.id}`);
          } else {
            result.hintConfidenceDecayed++;
          }
        }

        console.log(`✓ Decayed confidence for ${result.hintConfidenceDecayed} stale hints`);
      } else {
        console.log("✓ No stale hints requiring confidence decay");
      }
    } catch (error) {
      const message = `Confidence decay failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      console.error(message);
      result.errors.push(message);
    }

    const duration = Date.now() - startTime;
    console.log(`Maintenance completed in ${duration}ms`);
    console.log("Summary:", JSON.stringify(result, null, 2));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Maintenance job failed:", errorMessage);

    result.errors.push(errorMessage);

    return new Response(
      JSON.stringify({
        ...result,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
