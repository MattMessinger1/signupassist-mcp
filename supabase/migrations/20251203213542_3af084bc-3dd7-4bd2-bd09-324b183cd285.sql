-- Remove foreign key constraint on user_billing.user_id to allow mock users for testing
-- RLS policies already protect the table - FK to auth.users is unnecessary

ALTER TABLE public.user_billing DROP CONSTRAINT IF EXISTS user_billing_user_id_fkey;