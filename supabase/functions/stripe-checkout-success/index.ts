/**
 * Stripe Checkout Success Handler
 * 
 * Called after user completes Stripe Checkout setup mode.
 * Retrieves the saved payment method and updates user_billing.
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
  console.log(`[stripe-checkout-success] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const body = await req.json();
    const { session_id } = body;

    if (!session_id) {
      throw new Error("session_id is required");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['setup_intent.payment_method']
    });

    logStep("Session retrieved", { sessionId: session.id, customerId: session.customer });

    if (session.mode !== 'setup') {
      throw new Error("Invalid session mode - expected setup");
    }

    const setupIntent = session.setup_intent as Stripe.SetupIntent;
    if (!setupIntent) {
      throw new Error("No setup intent found in session");
    }

    const paymentMethod = setupIntent.payment_method as Stripe.PaymentMethod;
    if (!paymentMethod) {
      throw new Error("No payment method found in setup intent");
    }

    const userId = session.metadata?.supabase_user_id;
    if (!userId) {
      throw new Error("No user ID found in session metadata");
    }

    logStep("Payment method found", { 
      paymentMethodId: paymentMethod.id,
      brand: paymentMethod.card?.brand,
      last4: paymentMethod.card?.last4 
    });

    // Set as default payment method for invoice
    await stripe.customers.update(session.customer as string, {
      invoice_settings: {
        default_payment_method: paymentMethod.id
      }
    });

    // Update user_billing in Supabase
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { error: updateError } = await supabase
      .from('user_billing')
      .upsert({
        user_id: userId,
        stripe_customer_id: session.customer as string,
        default_payment_method_id: paymentMethod.id,
        payment_method_brand: paymentMethod.card?.brand || null,
        payment_method_last4: paymentMethod.card?.last4 || null,
        updated_at: new Date().toISOString()
      });

    if (updateError) {
      logStep("Error updating user_billing", { error: updateError });
      throw new Error(`Failed to update billing info: ${updateError.message}`);
    }

    logStep("User billing updated successfully");

    return new Response(
      JSON.stringify({
        success: true,
        payment_method_id: paymentMethod.id,
        brand: paymentMethod.card?.brand,
        last4: paymentMethod.card?.last4
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
