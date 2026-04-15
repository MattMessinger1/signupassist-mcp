/**
 * Stripe Subscription Success Handler
 *
 * Called by the web app after Stripe redirects back from subscription
 * Checkout. A webhook should also be configured in production, but this gives
 * the parent immediate in-app confirmation.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAN_ID = "signupassist_autopilot_monthly";
const PLAN_PRICE_CENTS = 900;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[stripe-subscription-success] ${step}${detailsStr}`);
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
      throw new Error("User must be signed in to confirm subscription");
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData.user?.id) {
      throw new Error("User must be signed in to confirm subscription");
    }

    const body = await req.json();
    const { session_id } = body;
    if (!session_id) throw new Error("session_id is required");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    if (session.mode !== "subscription") {
      throw new Error("Invalid session mode - expected subscription");
    }

    const sessionUserId = session.metadata?.supabase_user_id;
    if (!sessionUserId || sessionUserId !== authData.user.id) {
      throw new Error("Subscription session does not match signed-in user");
    }

    const subscription = session.subscription as Stripe.Subscription | string | null;
    if (!subscription || typeof subscription === "string") {
      throw new Error("No expanded subscription found in session");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const currentPeriodEnd = toIsoFromSeconds(subscription.current_period_end);

    const { error: updateError } = await supabaseAdmin
      .from("user_subscriptions")
      .upsert({
        user_id: authData.user.id,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        plan_id: PLAN_ID,
        price_cents: PLAN_PRICE_CENTS,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        updated_at: new Date().toISOString(),
      });

    if (updateError) {
      logStep("Error updating user_subscriptions", { error: updateError.message });
      throw new Error(`Failed to update subscription: ${updateError.message}`);
    }

    logStep("Subscription recorded", {
      userId: authData.user.id,
      subscriptionId: subscription.id,
      status: subscription.status,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: subscription.status,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
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
