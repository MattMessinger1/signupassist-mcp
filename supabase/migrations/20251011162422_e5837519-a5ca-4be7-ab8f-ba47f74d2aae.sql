-- Prevent multiple credentials per user/provider
ALTER TABLE stored_credentials
ADD CONSTRAINT unique_user_provider UNIQUE (user_id, provider);