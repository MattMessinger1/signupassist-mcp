/**
 * Billing - Stripe integration + success-flag logic (we only get paid if signup succeeds)
 */

import Stripe from 'stripe';

export interface BillingPlan {
  id: string;
  name: string;
  price: number; // in cents
  currency: string;
  features: string[];
  maxSignups: number;
}

export interface UserBilling {
  userId: string;
  stripeCustomerId: string;
  currentPlan: BillingPlan;
  successfulSignups: number;
  pendingCharges: PendingCharge[];
}

export interface PendingCharge {
  id: string;
  signupId: string;
  amount: number;
  currency: string;
  createdAt: Date;
  status: 'pending' | 'charged' | 'failed';
}

export class BillingService {
  private stripe: Stripe;

  constructor(stripeSecretKey: string) {
    this.stripe = new Stripe(stripeSecretKey);
  }

  /**
   * Create a pending charge for a signup attempt
   */
  async createPendingCharge(userId: string, signupId: string, amount: number): Promise<PendingCharge> {
    const pendingCharge: PendingCharge = {
      id: `charge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      signupId,
      amount,
      currency: 'usd',
      createdAt: new Date(),
      status: 'pending'
    };

    // TODO: Store in database
    console.log(`Created pending charge ${pendingCharge.id} for signup ${signupId}`);
    
    return pendingCharge;
  }

  /**
   * Charge the user after a successful signup
   */
  async chargeForSuccessfulSignup(userId: string, signupId: string): Promise<boolean> {
    try {
      // TODO: Get user billing info and pending charge from database
      const userBilling = await this.getUserBilling(userId);
      const pendingCharge = userBilling.pendingCharges.find(c => c.signupId === signupId);

      if (!pendingCharge) {
        throw new Error(`No pending charge found for signup ${signupId}`);
      }

      // Create Stripe payment intent
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: pendingCharge.amount,
        currency: pendingCharge.currency,
        customer: userBilling.stripeCustomerId,
        description: `Successful signup charge for signup ${signupId}`,
        confirm: true,
      });

      if (paymentIntent.status === 'succeeded') {
        pendingCharge.status = 'charged';
        userBilling.successfulSignups += 1;
        
        // TODO: Update database
        console.log(`Successfully charged user ${userId} for signup ${signupId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Failed to charge user ${userId} for signup ${signupId}:`, error);
      return false;
    }
  }

  /**
   * Create a new customer in Stripe
   */
  async createCustomer(email: string, name: string): Promise<string> {
    const customer = await this.stripe.customers.create({
      email,
      name,
    });

    return customer.id;
  }

  /**
   * Get user billing information
   */
  private async getUserBilling(userId: string): Promise<UserBilling> {
    // TODO: Implement database lookup
    throw new Error('User billing lookup not implemented');
  }

  /**
   * Predefined billing plans
   */
  static readonly BILLING_PLANS: BillingPlan[] = [
    {
      id: 'basic',
      name: 'Basic Plan',
      price: 500, // $5.00 per successful signup
      currency: 'usd',
      features: ['Automated signups', 'Email notifications'],
      maxSignups: 10
    },
    {
      id: 'pro',
      name: 'Pro Plan',
      price: 300, // $3.00 per successful signup
      currency: 'usd',
      features: ['Automated signups', 'Email/SMS notifications', 'Priority support'],
      maxSignups: 50
    },
    {
      id: 'enterprise',
      name: 'Enterprise Plan',
      price: 200, // $2.00 per successful signup
      currency: 'usd',
      features: ['Automated signups', 'All notifications', 'Dedicated support', 'Custom integrations'],
      maxSignups: -1 // unlimited
    }
  ];
}