-- Add encrypted PII envelope columns for children and delegate_profiles.
-- Envelope format (JSONB):
-- {
--   "v": 1,
--   "alg": "aes-256-gcm",
--   "kid": "v1",
--   "iv": "base64",
--   "ciphertext": "base64",
--   "tag": "base64"
-- }

ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS first_name_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS last_name_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS dob_encrypted JSONB;

ALTER TABLE public.delegate_profiles
  ADD COLUMN IF NOT EXISTS first_name_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS last_name_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS phone_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS email_encrypted JSONB,
  ADD COLUMN IF NOT EXISTS date_of_birth_encrypted JSONB;

COMMENT ON COLUMN public.children.first_name_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.children.last_name_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.children.dob_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';

COMMENT ON COLUMN public.delegate_profiles.first_name_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.delegate_profiles.last_name_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.delegate_profiles.phone_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.delegate_profiles.email_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
COMMENT ON COLUMN public.delegate_profiles.date_of_birth_encrypted IS 'AES-256-GCM encrypted envelope with key id metadata (kid).';
