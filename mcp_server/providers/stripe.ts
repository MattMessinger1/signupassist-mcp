/**
 * Stripe Provider - MCP Tools for Stripe payment operations
 * Handles success fee charging via edge function
 */

import { auditToolCall } from '../middleware/audit.js';
import { createClient } from '@supabase/supabase-js';
import type { ProviderResponse, ParentFriendlyError } from '../types.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface StripeTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
}

/**
 * Tool: stripe.charge_success_fee
 * Charge the $20 SignupAssist success fee to user's saved payment method
 */
async function chargeSuccessFee(args: {
  booking_number: string;
  mandate_id: string;
  amount_cents: number;
  user_jwt?: string;
  mandate_jws?: string;
}): Promise<ProviderResponse<any>> {
  const { booking_number, mandate_id, amount_cents } = args;
  
  console.log(`[Stripe] Charging success fee: $${amount_cents / 100} for booking ${booking_number}`);
  
  try {
    // Call the stripe-charge-success-fee edge function via Supabase
    const { data, error } = await supabase.functions.invoke(
      'stripe-charge-success-fee',
      {
        body: {
          booking_number,
          mandate_id,
          amount_cents
        }
      }
    );
    
    if (error) {
      console.error('[Stripe] Edge function error:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to process success fee',
        recovery: 'Your booking was successful, but the success fee charge failed. Support has been notified.',
        severity: 'medium',
        code: 'STRIPE_CHARGE_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    const charge_id = data?.charge_id || 'unknown';
    console.log(`[Stripe] ✅ Success fee charged: ${charge_id}`);
    
    return {
      success: true,
      data: {
        charge_id,
        amount_cents,
        booking_number,
        mandate_id
      },
      ui: {
        cards: [{
          title: 'Success Fee Processed',
          description: `$${amount_cents / 100} SignupAssist success fee charged successfully`
        }]
      }
    };
    
  } catch (error: any) {
    console.error('[Stripe] Error charging success fee:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Payment processing error',
      recovery: 'Your booking was successful. If you see a duplicate charge, contact support.',
      severity: 'medium',
      code: 'STRIPE_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Export Stripe tools for MCP server registration
 */
export const stripeTools: StripeTool[] = [
  {
    name: 'stripe.charge_success_fee',
    description: 'Charge the $20 SignupAssist success fee to user\'s saved payment method (only charged after successful booking)',
    inputSchema: {
      type: 'object',
      properties: {
        booking_number: {
          type: 'string',
          description: 'Booking confirmation number from provider (e.g., Bookeo)'
        },
        mandate_id: {
          type: 'string',
          description: 'Mandate ID authorizing the charge'
        },
        amount_cents: {
          type: 'number',
          description: 'Amount to charge in cents (e.g., 2000 for $20.00)'
        },
        user_jwt: {
          type: 'string',
          description: 'User JWT token for authentication (optional)'
        },
        mandate_jws: {
          type: 'string',
          description: 'Mandate JWS for authorization verification (optional)'
        }
      },
      required: ['booking_number', 'mandate_id', 'amount_cents']
    },
    handler: (args) => auditToolCall('stripe.charge_success_fee', args, chargeSuccessFee)
  }
];
