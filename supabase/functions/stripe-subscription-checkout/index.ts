/**
 * Stripe Subscription Checkout
 *
 * Creates a hosted Checkout session for the SignupAssist Autopilot monthly
 * membership. This is separate from the existing setup-mode Checkout flow used
 * by success-fee registrations.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAN_ID = "signupassist_autopilot_monthly";
const PLAN_NAME = "SignupAssist Autopilot";
const PLAN_PRICE_CENTS = 900;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[stripe-subscription-checkout] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("User must be signed in to subscribe");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authData.user?.id || !authData.user.email) {
      throw new Error("User must be signed in to subscribe");
    }

    const userId = authData.user.id;
    const userEmail = authData.user.email;
    const body = await req.json().catch(() => ({}));

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: existingBilling } = await supabaseAdmin
      .from("user_billing")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    let customerId = existingBilling?.stripe_customer_id as string | undefined;

    if (!customerId) {
      const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
      customerId = customers.data[0]?.id;
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      logStep("Created Stripe customer", { customerId });
    }

    await supabaseAdmin
      .from("user_billing")
      .upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });

    await supabaseAdmin
      .from("user_subscriptions")
      .upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        status: "checkout_started",
        plan_id: PLAN_ID,
        price_cents: PLAN_PRICE_CENTS,
        updated_at: new Date().toISOString(),
      });

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("PUBLIC_SITE_URL") ||
      Deno.env.get("SITE_URL") ||
      "https://signupassist.ai";

    const successUrl =
      body.success_url ||
      `${origin}/autopilot?subscription=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = body.cancel_url || `${origin}/autopilot?subscription=canceled`;
    const priceId = Deno.env.get("STRIPE_AUTOPILOT_PRICE_ID");

    const lineItem = priceId
      ? { price: priceId, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            product_data: {
              name: PLAN_NAME,
              description: "$9/month supervised signup autopilot",
            },
            recurring: { interval: "month" },
            unit_amount: PLAN_PRICE_CENTS,
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [lineItem],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        supabase_user_id: userId,
        plan_id: PLAN_ID,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
          plan_id: PLAN_ID,
        },
      },
    });

    logStep("Subscription Checkout session created", {
      sessionId: session.id,
      customerId,
    });

    return new Response(
      JSON.stringify({
        url: session.url,
        session_id: session.id,
        customer_id: customerId,
        plan_name: PLAN_NAME,
        price_cents: PLAN_PRICE_CENTS,
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
