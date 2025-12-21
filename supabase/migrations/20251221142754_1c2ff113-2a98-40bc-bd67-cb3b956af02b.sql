-- Change user_id from uuid to text for Auth0 compatibility
-- Auth0 IDs are strings like "auth0|xxxxx" which cannot be stored as uuid
-- Must drop FK constraints and RLS policies first

-- Step 1: Drop foreign key constraints
ALTER TABLE children DROP CONSTRAINT IF EXISTS children_user_id_fkey;
ALTER TABLE delegate_profiles DROP CONSTRAINT IF EXISTS delegate_profiles_user_id_fkey;
ALTER TABLE user_billing DROP CONSTRAINT IF EXISTS user_billing_user_id_fkey;
ALTER TABLE mandate_audit DROP CONSTRAINT IF EXISTS mandate_audit_user_id_fkey;

-- Step 2: Drop RLS policies that reference user_id (may already be dropped from previous attempt)
DROP POLICY IF EXISTS "Users can manage their own delegate profile" ON delegate_profiles;
DROP POLICY IF EXISTS "Users can manage their own children" ON children;
DROP POLICY IF EXISTS "Users can manage their own billing" ON user_billing;
DROP POLICY IF EXISTS "Service role can insert audit logs" ON mandate_audit;
DROP POLICY IF EXISTS "Users can view own audit logs" ON mandate_audit;

-- Step 3: Change column types from uuid to text
ALTER TABLE delegate_profiles 
  ALTER COLUMN user_id TYPE text USING user_id::text;

ALTER TABLE children 
  ALTER COLUMN user_id TYPE text USING user_id::text;

ALTER TABLE user_billing 
  ALTER COLUMN user_id TYPE text USING user_id::text;

ALTER TABLE mandate_audit 
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- Step 4: Recreate RLS policies with text comparison
-- Note: auth.uid() returns uuid, so we cast it to text for comparison

CREATE POLICY "Users can manage their own delegate profile"
  ON delegate_profiles FOR ALL
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage their own children"
  ON children FOR ALL
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage their own billing"
  ON user_billing FOR ALL
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role can insert audit logs"
  ON mandate_audit FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view own audit logs"
  ON mandate_audit FOR SELECT
  USING (auth.uid()::text = user_id);