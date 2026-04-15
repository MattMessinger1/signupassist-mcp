/**
 * Stripe Subscription Cancel Renewal
 *
 * Cancels the monthly renewal at period end. It does not delete profiles,
 * registration history, or the subscription row; access continues through the
 * paid period when Stripe reports a current period end.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[stripe-subscription-cancel] ${step}${detailsStr}`);
};

const toIsoFromSeconds = (value: unknown) => {
  if (typeof value !== "number") return null;
  return new Date(value * 1000).toISOString();
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("User must be signed in to cancel renewal");
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData.user?.id) {
      throw new Error("User must be signed in to cancel renewal");
    }

    const userId = authData.user.id;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: subscriptionRow, error: fetchError } = await supabaseAdmin
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!subscriptionRow?.stripe_subscription_id) {
      throw new Error("No active subscription found for this account");
    }

    const subscription = await stripe.subscriptions.update(subscriptionRow.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    const currentPeriodEnd =
      toIsoFromSeconds(subscription.current_period_end) ||
      subscriptionRow.current_period_end ||
      null;

    const { error: updateError } = await supabaseAdmin
      .from("user_subscriptions")
      .upsert({
        user_id: userId,
        stripe_customer_id: subscription.customer as string,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      });

    if (updateError) {
      throw new Error(`Failed to update subscription: ${updateError.message}`);
    }

    logStep("Renewal canceled", {
      userId,
      subscriptionId: subscription.id,
      currentPeriodEnd,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: subscription.status,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: true,
        message: currentPeriodEnd
          ? `You won't be charged again. Access continues until ${currentPeriodEnd}.`
          : "You won't be charged again.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });

    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
