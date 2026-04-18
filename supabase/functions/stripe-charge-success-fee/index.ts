import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-SUCCESS-FEE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      booking_number,
      mandate_id,
      amount_cents = 2000,
      user_id,
      parent_action_confirmation_id,
      idempotency_key,
    } = await req.json();

    if (!booking_number) throw new Error("booking_number is required");
    if (!mandate_id) throw new Error("mandate_id is required");
    if (!user_id) throw new Error("user_id is required");

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

    logStep("Payment gate paused success-fee charge", {
      booking_number,
      mandate_id,
      amount_cents,
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
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
