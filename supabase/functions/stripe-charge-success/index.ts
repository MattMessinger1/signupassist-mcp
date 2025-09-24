import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.11.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create service role client for database operations
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { plan_execution_id, user_id } = await req.json()
    
    if (!plan_execution_id || !user_id) {
      throw new Error('Plan execution ID and user ID are required')
    }

    console.log(`Processing success fee charge for plan execution ${plan_execution_id}, user ${user_id}`)

    // Get user billing info to find stripe customer
    const { data: billing, error: billingError } = await serviceSupabase
      .from('user_billing')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('user_id', user_id)
      .single()

    if (billingError || !billing?.stripe_customer_id || !billing?.default_payment_method_id) {
      throw new Error('No payment method found for user')
    }

    console.log(`Found Stripe customer ${billing.stripe_customer_id} with payment method ${billing.default_payment_method_id}`)

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    })

    // Create payment intent for $20 success fee
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2000, // $20.00 in cents
      currency: 'usd',
      customer: billing.stripe_customer_id,
      payment_method: billing.default_payment_method_id,
      confirmation_method: 'automatic',
      confirm: true,
      off_session: true, // Indicates this is for a payment without customer present
      description: `SignupAssist success fee for plan execution ${plan_execution_id}`,
      metadata: {
        plan_execution_id,
        user_id,
        service: 'signupassist_success_fee'
      }
    })

    console.log(`Payment intent created: ${paymentIntent.id}, status: ${paymentIntent.status}`)

    // Record the charge in our database
    const { data: charge, error: chargeError } = await serviceSupabase
      .from('charges')
      .insert({
        plan_execution_id,
        amount_cents: 2000,
        stripe_payment_intent: paymentIntent.id,
        status: paymentIntent.status === 'succeeded' ? 'completed' : 'pending'
      })
      .select()
      .single()

    if (chargeError) {
      console.error('Error recording charge:', chargeError)
      throw new Error('Failed to record charge in database')
    }

    console.log(`Charge recorded in database: ${charge.id}`)

    return new Response(
      JSON.stringify({
        success: true,
        charge_id: charge.id,
        payment_intent_id: paymentIntent.id,
        amount_cents: 2000,
        status: paymentIntent.status
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in stripe-charge-success:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})