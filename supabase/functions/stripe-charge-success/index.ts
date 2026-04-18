import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      plan_execution_id,
      user_id,
      parent_action_confirmation_id,
      idempotency_key,
    } = await req.json();

    if (!plan_execution_id || !user_id) {
      throw new Error("Plan execution ID and user ID are required");
    }

    if (!parent_action_confirmation_id || !idempotency_key) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "payment_review_required",
          error: "payment_confirmation_and_idempotency_key_required",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Payment gate paused success-fee charge", {
      plan_execution_id,
      user_id,
      parent_action_confirmation_id,
      idempotency_key_present: true,
    });

    return new Response(
      JSON.stringify({
        success: false,
        status: "payment_review_required",
        error: "automated_payment_disabled_until_verified_provider_payment_gate",
      }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in stripe-charge-success:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        success: false,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
