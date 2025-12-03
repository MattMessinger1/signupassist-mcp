import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-REFUND-FEE] ${step}${detailsStr}`);
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

    // Parse request
    const { charge_id, reason } = await req.json();
    
    if (!charge_id) throw new Error("charge_id is required");
    
    logStep("Request parsed", { charge_id, reason });

    // Get charge record to find the Stripe payment intent
    const { data: charge, error: chargeError } = await supabaseClient
      .from('charges')
      .select('id, stripe_payment_intent, status, refunded_at, amount_cents, mandate_id')
      .eq('id', charge_id)
      .single();

    if (chargeError || !charge) {
      throw new Error(`Charge not found: ${charge_id}`);
    }

    if (charge.refunded_at) {
      throw new Error("Charge has already been refunded");
    }

    if (!charge.stripe_payment_intent) {
      throw new Error("No Stripe payment intent found for this charge");
    }

    logStep("Charge retrieved", { 
      payment_intent: charge.stripe_payment_intent,
      status: charge.status,
      amount_cents: charge.amount_cents
    });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Create refund for the payment intent
    const refund = await stripe.refunds.create({
      payment_intent: charge.stripe_payment_intent,
      reason: reason || 'requested_by_customer'
    });

    logStep("Refund created", { 
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount
    });

    // Update charge record with refund info
    const { error: updateError } = await supabaseClient
      .from('charges')
      .update({
        status: 'refunded',
        refunded_at: new Date().toISOString()
      })
      .eq('id', charge_id);

    if (updateError) {
      logStep("Warning: Failed to update charge record", { error: updateError.message });
      // Don't fail the request - refund succeeded
    } else {
      logStep("Charge record updated to refunded");
    }

    return new Response(JSON.stringify({ 
      success: true,
      refund_id: refund.id,
      refund_status: refund.status,
      amount_refunded_cents: refund.amount,
      charge_id
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
