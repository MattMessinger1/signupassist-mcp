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

    // Parse request body to get user data
    const { user_id, email } = await req.json();
    if (!user_id || !email) {
      throw new Error("user_id and email are required");
    }
    
    const userId = user_id;
    const userEmail = email;
    logStep("Processing for user", { userId, email: userEmail });

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

    // Check if this is a mock/test user ID (doesn't exist in auth.users)
    const isMockUser = userId.startsWith('00000000-0000-0000-0000-');
    
    if (isMockUser) {
      logStep("Mock user detected, skipping user_billing insert", { userId });
      // Return success without DB write for mock users
      return new Response(JSON.stringify({ 
        success: true, 
        customer_id: customer.id,
        message: "Customer created (mock user - not persisted)"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Save customer ID to user_billing table (real users only)
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