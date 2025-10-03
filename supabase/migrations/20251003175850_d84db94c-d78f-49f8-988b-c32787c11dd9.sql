-- Add meta column to plans table for storing caps, notes, reminders, and other metadata
ALTER TABLE plans ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Add index for faster meta queries
CREATE INDEX IF NOT EXISTS idx_plans_meta ON plans USING gin(meta);