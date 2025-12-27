-- Add provider payment state fields to registrations.
-- Provider is merchant-of-record for program fees; we store state for UX only.

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS provider_payment_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_amount_due_cents INTEGER,
  ADD COLUMN IF NOT EXISTS provider_amount_paid_cents INTEGER,
  ADD COLUMN IF NOT EXISTS provider_currency TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_last_checked_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.registrations.provider_payment_status IS
  'Normalized provider payment status for program fee: paid|unpaid|unknown. Provider is merchant-of-record.';
COMMENT ON COLUMN public.registrations.provider_amount_due_cents IS
  'Best-effort cents amount due to provider (program fee).';
COMMENT ON COLUMN public.registrations.provider_amount_paid_cents IS
  'Best-effort cents amount paid to provider (program fee).';
COMMENT ON COLUMN public.registrations.provider_currency IS
  'Currency code reported/assumed for provider amounts (e.g., USD).';
COMMENT ON COLUMN public.registrations.provider_payment_last_checked_at IS
  'Timestamp when provider payment status was last fetched from provider APIs.';


