import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types.js';

type BillingSupabaseClient = SupabaseClient<Database>;

export interface HostedPaymentSetupSession {
  url: string;
  session_id: string;
  customer_id: string;
}

export interface FinalizedHostedPaymentSetup {
  payment_method_id: string;
  brand?: string;
  last4?: string;
  customer_id: string;
}

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(stripeKey);
  }

  return stripeClient;
}

function getPublicBaseUrl(): string {
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
  if (publicDomain) {
    return publicDomain.startsWith('http') ? publicDomain : `https://${publicDomain}`;
  }
  return 'https://signupassist.shipworx.ai';
}

function isMissingStripeCustomer(error: unknown): boolean {
  const stripeError = error as { code?: string; raw?: { code?: string } };
  return stripeError.code === 'resource_missing' || stripeError.raw?.code === 'resource_missing';
}

async function retrieveUsableStripeCustomer(stripe: Stripe, customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ('deleted' in customer && customer.deleted) {
      return null;
    }
    return customer.id;
  } catch (error) {
    if (isMissingStripeCustomer(error)) {
      return null;
    }
    throw error;
  }
}

function buildSignupAssistCheckoutUrl(sessionId: string): string {
  const url = new URL('/stripe_checkout', getPublicBaseUrl());
  url.searchParams.set('session_id', sessionId);
  return url.toString();
}

export function normalizeStripeRedirectUrl(value: string | undefined, fallback: string): string {
  const candidate = String(value || fallback).trim();
  try {
    const parsed = new URL(candidate);
    const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

async function getOrCreateStripeCustomer(args: {
  supabase: BillingSupabaseClient;
  userId: string;
  userEmail: string;
  stripe: Stripe;
}): Promise<string> {
  const { supabase, userId, userEmail, stripe } = args;

  const { data: billing, error: billingError } = await supabase
    .from('user_billing')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (billingError) {
    throw new Error(`Unable to read billing profile: ${billingError.message}`);
  }

  if (billing?.stripe_customer_id) {
    const usableCustomerId = await retrieveUsableStripeCustomer(stripe, billing.stripe_customer_id);
    if (usableCustomerId) {
      return usableCustomerId;
    }

    console.warn('[Stripe] Stored customer is unavailable in the active Stripe account; creating a replacement customer.');
  }

  const existing = await stripe.customers.list({ email: userEmail, limit: 1 });
  const customerId = existing.data[0]?.id || (await stripe.customers.create({
    email: userEmail,
    metadata: { supabase_user_id: userId },
  })).id;

  const { error: upsertError } = await supabase
    .from('user_billing')
    .upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      default_payment_method_id: null,
      payment_method_brand: null,
      payment_method_last4: null,
      updated_at: new Date().toISOString(),
    });

  if (upsertError) {
    throw new Error(`Unable to save billing profile: ${upsertError.message}`);
  }

  return customerId;
}

export async function createHostedPaymentSetupSession(args: {
  supabase: BillingSupabaseClient;
  userId: string;
  userEmail: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<HostedPaymentSetupSession> {
  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomer({
    supabase: args.supabase,
    userId: args.userId,
    userEmail: args.userEmail,
    stripe,
  });

  const baseUrl = getPublicBaseUrl();
  const successUrl = normalizeStripeRedirectUrl(
    args.successUrl,
    `${baseUrl}/stripe_return?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
  );
  const cancelUrl = normalizeStripeRedirectUrl(
    args.cancelUrl,
    `${baseUrl}/stripe_return?payment_setup=canceled`,
  );

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'setup',
    payment_method_types: ['card'],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      supabase_user_id: args.userId,
    },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }

  return {
    url: buildSignupAssistCheckoutUrl(session.id),
    session_id: session.id,
    customer_id: customerId,
  };
}

export async function getHostedPaymentSetupCheckoutUrl(sessionId: string): Promise<string> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new Error('Invalid Stripe Checkout session ID');
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.mode !== 'setup' || !session.url) {
    throw new Error('Stripe Checkout setup session is not available');
  }

  return session.url;
}

export async function finalizeHostedPaymentSetupSession(args: {
  supabase: BillingSupabaseClient;
  sessionId: string;
}): Promise<FinalizedHostedPaymentSetup> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(args.sessionId, {
    expand: ['setup_intent.payment_method'],
  });

  if (session.mode !== 'setup') {
    throw new Error('Invalid Stripe Checkout session mode');
  }

  const setupIntent = session.setup_intent as Stripe.SetupIntent | null;
  const paymentMethod = setupIntent?.payment_method as Stripe.PaymentMethod | null;
  const userId = session.metadata?.supabase_user_id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!paymentMethod?.id || !userId || !customerId) {
    throw new Error('Stripe Checkout session is missing payment setup details');
  }

  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  });

  const { error } = await args.supabase
    .from('user_billing')
    .upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      default_payment_method_id: paymentMethod.id,
      payment_method_brand: paymentMethod.card?.brand || null,
      payment_method_last4: paymentMethod.card?.last4 || null,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Unable to save payment method: ${error.message}`);
  }

  return {
    payment_method_id: paymentMethod.id,
    brand: paymentMethod.card?.brand || undefined,
    last4: paymentMethod.card?.last4 || undefined,
    customer_id: customerId,
  };
}
