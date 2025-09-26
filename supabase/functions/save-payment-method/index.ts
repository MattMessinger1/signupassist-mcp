import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper logging function for debugging
const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SAVE-PAYMENT-METHOD] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Verify Stripe secret key
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    if (!stripeKey.startsWith('sk_')) {
      throw new Error("Invalid STRIPE_SECRET_KEY format. Must start with sk_");
    }
    logStep("Stripe secret key verified");

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) {
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    const user = userData.user;
    if (!user?.email) {
      throw new Error("User not authenticated or email not available");
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Parse request body
    const { payment_method_id, customer_id } = await req.json();
    
    if (!payment_method_id) {
      throw new Error("payment_method_id is required");
    }
    if (!customer_id) {
      throw new Error("customer_id is required");
    }
    
    logStep("Request body parsed", { payment_method_id, customer_id });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Attach payment method to customer
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: customer_id,
    });
    logStep("Payment method attached to customer");

    // Set as default payment method for invoices
    await stripe.customers.update(customer_id, {
      invoice_settings: {
        default_payment_method: payment_method_id,
      },
    });
    logStep("Payment method set as default");

    // Update user_billing table with the default payment method
    const { error: updateError } = await supabaseClient
      .from('user_billing')
      .upsert({
        user_id: user.id,
        stripe_customer_id: customer_id,
        default_payment_method_id: payment_method_id,
        updated_at: new Date().toISOString(),
      });

    if (updateError) {
      logStep("Error updating user_billing", { error: updateError.message });
      throw new Error(`Failed to update user billing: ${updateError.message}`);
    }
    logStep("User billing updated successfully");

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in save-payment-method", { message: errorMessage });
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});