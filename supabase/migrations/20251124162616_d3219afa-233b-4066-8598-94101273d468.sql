-- Phase A.2: Modify charges table (add mandate_id, drop plan_execution_id, update RLS)
-- Fixed order: drop policy BEFORE dropping column

-- Drop existing RLS policy first (it depends on plan_execution_id)
DROP POLICY IF EXISTS "Users can view their charges" ON charges;

-- Add mandate_id column
ALTER TABLE charges ADD COLUMN mandate_id UUID REFERENCES mandates(id);

-- Now we can drop plan_execution_id
ALTER TABLE charges DROP COLUMN plan_execution_id;

-- Create new RLS policy referencing mandates
CREATE POLICY "Users can view their charges" ON charges
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM mandates m
    WHERE m.id = charges.mandate_id
    AND m.user_id = auth.uid()
  )
);