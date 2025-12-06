/**
 * Stripe Checkout Setup Session
 * 
 * Creates a Stripe Checkout session in 'setup' mode for PCI-compliant
 * payment method collection. Users are redirected to Stripe's hosted page
 * to enter card details, then redirected back with saved payment method.
 * 
 * ChatGPT App Store Compliance: No in-app card input (PCI violation).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[stripe-checkout-setup] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Check for user authentication
    const authHeader = req.headers.get("Authorization");
    let userId: string | undefined;
    let userEmail: string | undefined;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabaseClient.auth.getUser(token);
      userId = data.user?.id;
      userEmail = data.user?.email ?? undefined;
      logStep("User authenticated", { userId, email: userEmail });
    }

    // Parse request body for additional context
    const body = await req.json().catch(() => ({}));
    const { 
      success_url, 
      cancel_url,
      user_id: bodyUserId,
      user_email: bodyUserEmail 
    } = body;

    // Use body params as fallback for test harness
    userId = userId || bodyUserId;
    userEmail = userEmail || bodyUserEmail;

    if (!userId || !userEmail) {
      throw new Error("User not authenticated or email not available");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if Stripe customer exists
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    let customerId: string;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId }
      });
      customerId = customer.id;
      logStep("Created new Stripe customer", { customerId });

      // Store in user_billing
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      
      await supabaseAdmin
        .from('user_billing')
        .upsert({
          user_id: userId,
          stripe_customer_id: customerId
        });
    }

    // Build URLs with origin fallback
    const origin = req.headers.get("origin") || "https://signupassist.ai";
    const finalSuccessUrl = success_url || `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancel_url || `${origin}/payment-canceled`;

    // Create Stripe Checkout session in setup mode
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "setup",
      payment_method_types: ["card"],
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      metadata: {
        supabase_user_id: userId
      }
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(
      JSON.stringify({ 
        url: session.url,
        session_id: session.id,
        customer_id: customerId
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
