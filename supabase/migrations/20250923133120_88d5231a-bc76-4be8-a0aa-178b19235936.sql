-- Add credential_type column to mandates table
ALTER TABLE public.mandates 
ADD COLUMN credential_type text NOT NULL DEFAULT 'jws';

-- Add constraint to ensure only valid credential types
ALTER TABLE public.mandates 
ADD CONSTRAINT mandates_credential_type_check 
CHECK (credential_type IN ('jws', 'vc'));