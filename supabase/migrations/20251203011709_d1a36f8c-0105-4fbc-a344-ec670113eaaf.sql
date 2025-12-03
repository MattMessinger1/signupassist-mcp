-- Add refunded_at column to charges table for tracking refunds
ALTER TABLE public.charges ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone DEFAULT NULL;

-- Add index for efficient refund queries
CREATE INDEX IF NOT EXISTS idx_charges_refunded_at ON public.charges(refunded_at) WHERE refunded_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.charges.refunded_at IS 'Timestamp when the charge was refunded (null if not refunded)';