-- Allow delegate_email to be nullable for VGS compliance
-- We'll store masked email like "[TOKENIZED]" instead of raw PII
ALTER TABLE public.registrations 
ALTER COLUMN delegate_email DROP NOT NULL;

-- Add comment explaining the column's purpose
COMMENT ON COLUMN public.registrations.delegate_email IS 'Stores masked placeholder when VGS tokenization is enabled. Raw email stored only for legacy records or when VGS disabled.';