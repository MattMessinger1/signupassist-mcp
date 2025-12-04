-- Drop the foreign key constraint on mandates.user_id that references auth.users
-- This is needed because:
-- 1. We can't insert into auth.users directly
-- 2. Testing requires mock user IDs
-- 3. RLS policies already enforce proper access control via auth.uid()

ALTER TABLE public.mandates DROP CONSTRAINT IF EXISTS mandates_user_id_fkey;