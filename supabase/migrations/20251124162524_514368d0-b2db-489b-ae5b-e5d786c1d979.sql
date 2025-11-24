-- Phase A.1: Migrate children table (split name into first_name/last_name)

-- Add new columns
ALTER TABLE children ADD COLUMN first_name TEXT;
ALTER TABLE children ADD COLUMN last_name TEXT;

-- Backfill existing data (split on first space)
UPDATE children 
SET 
  first_name = SPLIT_PART(name, ' ', 1),
  last_name = CASE 
    WHEN POSITION(' ' IN name) > 0 THEN SUBSTRING(name FROM POSITION(' ' IN name) + 1)
    ELSE SPLIT_PART(name, ' ', 1)
  END;

-- Set NOT NULL after backfill
ALTER TABLE children ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE children ALTER COLUMN last_name SET NOT NULL;

-- Drop old column (forward-looking, no backwards compatibility)
ALTER TABLE children DROP COLUMN name;