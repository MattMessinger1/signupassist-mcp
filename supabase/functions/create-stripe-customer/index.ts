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
  console.log(`[CREATE-STRIPE-CUSTOMER] ${step}${detailsStr}`);
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

    // Initialize Supabase client with service role for admin operations
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Authenticate user (optional for webhook-triggered calls)
    const authHeader = req.headers.get("Authorization");
    let userId: string;
    let userEmail: string;

    if (authHeader) {
      // Called by authenticated user
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
      if (userError || !userData.user) {
        throw new Error("Authentication failed");
      }
      userId = userData.user.id;
      userEmail = userData.user.email!;
      logStep("User authenticated", { userId, email: userEmail });
    } else {
      // Called via webhook or direct call with user data in body
      const { user_id, email } = await req.json();
      if (!user_id || !email) {
        throw new Error("user_id and email are required when not authenticated");
      }
      userId = user_id;
      userEmail = email;
      logStep("User data from request body", { userId, email: userEmail });
    }

    // Check if user already has a Stripe customer
    const { data: existingBilling } = await supabaseClient
      .from('user_billing')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (existingBilling?.stripe_customer_id) {
      logStep("User already has Stripe customer", { customerId: existingBilling.stripe_customer_id });
      return new Response(JSON.stringify({ 
        success: true, 
        customer_id: existingBilling.stripe_customer_id,
        message: "Customer already exists"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: {
        supabase_uid: userId,
      },
    });
    logStep("Stripe customer created", { customerId: customer.id });

    // Save customer ID to user_billing table
    const { error: insertError } = await supabaseClient
      .from('user_billing')
      .upsert({
        user_id: userId,
        stripe_customer_id: customer.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      logStep("Error saving to user_billing", { error: insertError.message });
      throw new Error(`Failed to save customer ID: ${insertError.message}`);
    }
    logStep("Customer ID saved to user_billing");

    return new Response(JSON.stringify({ 
      success: true, 
      customer_id: customer.id 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-stripe-customer", { message: errorMessage });
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});