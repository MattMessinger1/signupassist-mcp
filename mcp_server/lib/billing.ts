/**
 * Billing Integration with Stripe
 * Handles charging for successful plan executions
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { verifyMandate } from './mandates.js';
import { auditToolCall } from '../middleware/audit.js';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ChargeOnSuccessArgs {
  plan_execution_id: string;
  mandate_id: string;
}

/**
 * Create a Stripe charge for a successful plan execution
 */
export async function chargeOnSuccess(args: ChargeOnSuccessArgs): Promise<{ charge_id: string; status: string }> {
  return auditToolCall(
    {
      plan_execution_id: args.plan_execution_id,
      mandate_id: args.mandate_id,
      tool: 'billing.charge_on_success'
    },
    args,
    async () => {
      // Verify mandate has required scope
      await verifyMandate(args.mandate_id, 'scp:pay');

      // Look up plan execution
      const { data: planExecution, error: planError } = await supabase
        .from('plan_executions')
        .select('*, plans!inner(user_id)')
        .eq('id', args.plan_execution_id)
        .single();

      if (planError || !planExecution) {
        throw new Error(`Plan execution not found: ${args.plan_execution_id}`);
      }

      // Ensure result is success
      if (planExecution.result !== 'success') {
        throw new Error(`Plan execution must have result 'success', got: ${planExecution.result}`);
      }

      // Check if charge already exists (idempotency)
      const { data: existingCharge } = await supabase
        .from('charges')
        .select('*')
        .eq('plan_execution_id', args.plan_execution_id)
        .single();

      if (existingCharge) {
        return {
          charge_id: existingCharge.id,
          status: existingCharge.status
        };
      }

      // Get amount from plan execution
      const amountCents = planExecution.amount_cents;
      if (!amountCents || amountCents <= 0) {
        throw new Error('Invalid amount for charging');
      }

      let chargeStatus = 'pending';
      let stripePaymentIntent = null;

      try {
        // Create Stripe PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          automatic_payment_methods: {
            enabled: true,
          },
          metadata: {
            plan_execution_id: args.plan_execution_id,
            mandate_id: args.mandate_id,
          },
        });

        stripePaymentIntent = paymentIntent.id;
        chargeStatus = 'succeeded';
      } catch (error) {
        console.error('Stripe error:', error);
        chargeStatus = 'failed';
      }

      // Insert charge record
      const { data: charge, error: chargeError } = await supabase
        .from('charges')
        .insert({
          plan_execution_id: args.plan_execution_id,
          stripe_payment_intent: stripePaymentIntent,
          amount_cents: amountCents,
          status: chargeStatus,
        })
        .select()
        .single();

      if (chargeError) {
        throw new Error(`Failed to create charge record: ${chargeError.message}`);
      }

      return {
        charge_id: charge.id,
        status: charge.status
      };
    },
    'billing:charge'
  );
}

// MCP Tool Export
export const billingTools = {
  'billing.charge_on_success': chargeOnSuccess
};