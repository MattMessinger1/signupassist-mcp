-- Add provider checkout URL to registrations for provider-as-merchant-of-record payments.
-- This stores the provider-hosted Stripe/Bookeo checkout link (or booking page link)
-- so the user can complete payment directly with the provider after SignupAssist secures the spot.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS provider_checkout_url TEXT;

COMMENT ON COLUMN public.registrations.provider_checkout_url IS
  'Provider-hosted checkout/payment URL (provider is Merchant of Record). SignupAssist does not process program-fee refunds; provider handles program refunds/disputes.';


