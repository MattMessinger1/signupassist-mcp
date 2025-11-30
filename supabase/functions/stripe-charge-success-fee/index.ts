import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-SUCCESS-FEE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey || !stripeKey.startsWith('sk_')) {
      throw new Error("Invalid STRIPE_SECRET_KEY");
    }
    logStep("Stripe key verified");

    // Initialize Supabase with service role (server-to-server call)
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse request (user_id required in body for server-to-server calls)
    const { booking_number, mandate_id, amount_cents = 2000, user_id } = await req.json();
    
    if (!booking_number) throw new Error("booking_number is required");
    if (!mandate_id) throw new Error("mandate_id is required");
    if (!user_id) throw new Error("user_id is required");
    
    logStep("Request parsed", { booking_number, mandate_id, amount_cents, user_id });

    // Get user's payment method from user_billing (using provided user_id)
    const { data: billing, error: billingError } = await supabaseClient
      .from('user_billing')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('user_id', user_id)
      .single();

    if (billingError || !billing) {
      throw new Error("User billing not found");
    }

    if (!billing.default_payment_method_id) {
      throw new Error("No default payment method configured");
    }

    logStep("Billing retrieved", { 
      customer_id: billing.stripe_customer_id,
      has_payment_method: !!billing.default_payment_method_id 
    });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Create and confirm PaymentIntent for $20 success fee
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: 'usd',
      customer: billing.stripe_customer_id,
      payment_method: billing.default_payment_method_id,
      off_session: true,
      confirm: true,
      description: `SignupAssist Success Fee - Booking ${booking_number}`,
      metadata: {
        booking_number,
        mandate_id,
        user_id: userId,
        type: 'platform_success_fee'
      }
    });

    logStep("PaymentIntent created", { 
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status 
    });

    // Record charge in charges table
    const { error: chargeError } = await supabaseClient
      .from('charges')
      .insert({
        mandate_id,
        stripe_payment_intent: paymentIntent.id,
        amount_cents,
        status: paymentIntent.status,
        charged_at: new Date().toISOString()
      });

    if (chargeError) {
      logStep("Warning: Failed to record charge in database", { error: chargeError.message });
      // Don't fail the request - payment succeeded
    } else {
      logStep("Charge recorded in database");
    }

    return new Response(JSON.stringify({ 
      success: true,
      charge_id: paymentIntent.id,
      status: paymentIntent.status,
      amount_cents
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
