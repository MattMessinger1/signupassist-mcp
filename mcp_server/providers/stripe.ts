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
  user_id?: string;
  user_jwt?: string;
  mandate_jws?: string;
}): Promise<ProviderResponse<any>> {
  const { booking_number, mandate_id, amount_cents, user_id } = args;
  
  console.log(`[Stripe] Charging success fee: $${amount_cents / 100} for booking ${booking_number}`);
  
  if (!user_id) {
    console.error('[Stripe] Missing user_id - cannot charge success fee');
    const friendlyError: ParentFriendlyError = {
      display: 'Unable to process success fee',
      recovery: 'Your booking was successful, but we need your account information to process the fee. Please contact support.',
      severity: 'medium',
      code: 'STRIPE_MISSING_USER_ID'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
  
  try {
    // Call the stripe-charge-success-fee edge function via Supabase (service-to-service)
    const { data, error } = await supabase.functions.invoke(
      'stripe-charge-success-fee',
      {
        body: {
          booking_number,
          mandate_id,
          amount_cents,
          user_id  // Required for server-to-server call
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
 * Tool: stripe.create_customer
 * Create a Stripe customer for a user
 */
async function createStripeCustomer(args: {
  user_id: string;
  email: string;
}): Promise<ProviderResponse<any>> {
  const { user_id, email } = args;
  
  console.log(`[Stripe] Creating customer for user: ${email}`);
  
  try {
    // Call the create-stripe-customer edge function via Supabase
    const { data, error } = await supabase.functions.invoke(
      'create-stripe-customer',
      {
        body: {
          user_id,
          email
        }
      }
    );
    
    if (error) {
      console.error('[Stripe] Edge function error:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to set up payment account',
        recovery: 'Please try again or contact support.',
        severity: 'medium',
        code: 'STRIPE_CUSTOMER_CREATION_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    const customer_id = data?.customer_id || 'unknown';
    console.log(`[Stripe] ✅ Customer created: ${customer_id}`);
    
    return {
      success: true,
      data: {
        customer_id,
        user_id,
        email
      }
    };
    
  } catch (error: any) {
    console.error('[Stripe] Error creating customer:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Payment setup error',
      recovery: 'Please try again or contact support.',
      severity: 'medium',
      code: 'STRIPE_CUSTOMER_API_ERROR'
    };
    return {
      success: false,
      error: friendlyError
    };
  }
}

/**
 * Tool: stripe.save_payment_method
 * Save a payment method to a Stripe customer
 */
async function savePaymentMethod(args: {
  payment_method_id: string;
  customer_id: string;
  user_jwt: string;
}): Promise<ProviderResponse<any>> {
  const { payment_method_id, customer_id, user_jwt } = args;
  
  console.log(`[Stripe] Saving payment method for customer: ${customer_id}`);
  
  try {
    // Call the save-payment-method edge function via Supabase
    const { data, error } = await supabase.functions.invoke(
      'save-payment-method',
      {
        body: {
          payment_method_id,
          customer_id
        },
        headers: {
          Authorization: `Bearer ${user_jwt}`
        }
      }
    );
    
    if (error) {
      console.error('[Stripe] Edge function error:', error);
      const friendlyError: ParentFriendlyError = {
        display: 'Unable to save payment method',
        recovery: 'Please try again or contact support.',
        severity: 'medium',
        code: 'STRIPE_PAYMENT_METHOD_SAVE_FAILED'
      };
      return {
        success: false,
        error: friendlyError
      };
    }
    
    console.log(`[Stripe] ✅ Payment method saved: ${payment_method_id}`);
    
    return {
      success: true,
      data: {
        payment_method_id,
        customer_id
      }
    };
    
  } catch (error: any) {
    console.error('[Stripe] Error saving payment method:', error);
    const friendlyError: ParentFriendlyError = {
      display: 'Payment setup error',
      recovery: 'Please try again or contact support.',
      severity: 'medium',
      code: 'STRIPE_PAYMENT_METHOD_API_ERROR'
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
        user_id: {
          type: 'string',
          description: 'Supabase user ID for billing lookup'
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
      required: ['booking_number', 'mandate_id', 'amount_cents', 'user_id']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'stripe.charge_success_fee' },
        args,
        () => chargeSuccessFee(args)
      );
    }
  },
  {
    name: 'stripe.create_customer',
    description: 'Create a Stripe customer for a user',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'Supabase user ID'
        },
        email: {
          type: 'string',
          description: 'User email address'
        }
      },
      required: ['user_id', 'email']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'stripe.create_customer' },
        args,
        () => createStripeCustomer(args)
      );
    }
  },
  {
    name: 'stripe.save_payment_method',
    description: 'Save a payment method to a Stripe customer',
    inputSchema: {
      type: 'object',
      properties: {
        payment_method_id: {
          type: 'string',
          description: 'Stripe payment method ID (from Stripe Elements)'
        },
        customer_id: {
          type: 'string',
          description: 'Stripe customer ID'
        },
        user_jwt: {
          type: 'string',
          description: 'User JWT token for authentication'
        }
      },
      required: ['payment_method_id', 'customer_id', 'user_jwt']
    },
    handler: async (args: any) => {
      return auditToolCall(
        { plan_execution_id: null, tool: 'stripe.save_payment_method' },
        args,
        () => savePaymentMethod(args)
      );
    }
  }
];
