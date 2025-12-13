-- Migration: Add VGS alias columns for PII tokenization
-- These columns store VGS tokens instead of raw PII

-- Add alias columns to delegate_profiles
ALTER TABLE delegate_profiles 
  ADD COLUMN IF NOT EXISTS phone_alias TEXT,
  ADD COLUMN IF NOT EXISTS email_alias TEXT;

-- Add alias column to registrations
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS delegate_email_alias TEXT;

-- Create indexes for alias lookups (used when detokenizing)
CREATE INDEX IF NOT EXISTS idx_delegate_profiles_phone_alias 
  ON delegate_profiles(phone_alias) 
  WHERE phone_alias IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delegate_profiles_email_alias 
  ON delegate_profiles(email_alias) 
  WHERE email_alias IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_email_alias 
  ON registrations(delegate_email_alias) 
  WHERE delegate_email_alias IS NOT NULL;

-- Add comment documenting the VGS tokenization pattern
COMMENT ON COLUMN delegate_profiles.phone_alias IS 'VGS tokenized phone number (tok_xxx format). Raw phone is deprecated.';
COMMENT ON COLUMN delegate_profiles.email_alias IS 'VGS tokenized email (tok_xxx format). Use delegate_email on registrations for raw.';
COMMENT ON COLUMN registrations.delegate_email_alias IS 'VGS tokenized delegate email (tok_xxx format). delegate_email is deprecated.';