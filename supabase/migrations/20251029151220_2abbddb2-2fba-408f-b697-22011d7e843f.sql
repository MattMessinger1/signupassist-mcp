-- Add unique constraint on (user_id, alias) for stored_credentials
-- This enables ON CONFLICT (user_id, alias) in upsert operations

ALTER TABLE stored_credentials
ADD CONSTRAINT stored_credentials_user_alias_unique
UNIQUE (user_id, alias);