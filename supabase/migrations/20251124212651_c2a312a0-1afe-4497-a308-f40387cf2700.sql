-- Phase 2: Create scheduled_registrations table for Set & Forget auto-registration

CREATE TABLE scheduled_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  mandate_id UUID REFERENCES mandates(id) NOT NULL,
  
  -- Program Info
  org_ref TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  program_name TEXT NOT NULL,
  
  -- Scheduling (comes from Bookeo booking_opens_at)
  scheduled_time TIMESTAMPTZ NOT NULL,
  event_id TEXT NOT NULL,  -- Bookeo slot eventId
  
  -- Registration Data (two-tier form structure)
  delegate_data JSONB NOT NULL,
  participant_data JSONB NOT NULL,
  
  -- Execution Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
  
  -- Results
  booking_number TEXT,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding pending registrations efficiently
CREATE INDEX idx_scheduled_pending 
  ON scheduled_registrations(scheduled_time) 
  WHERE status = 'pending';

-- Index for user's scheduled registrations
CREATE INDEX idx_scheduled_by_user 
  ON scheduled_registrations(user_id, created_at DESC);

-- RLS Policies for scheduled_registrations
ALTER TABLE scheduled_registrations ENABLE ROW LEVEL SECURITY;

-- Users can view their own scheduled registrations
CREATE POLICY "Users can view their own scheduled registrations"
  ON scheduled_registrations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own scheduled registrations
CREATE POLICY "Users can insert their own scheduled registrations"
  ON scheduled_registrations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own scheduled registrations (to cancel)
CREATE POLICY "Users can update their own scheduled registrations"
  ON scheduled_registrations
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role can update any scheduled registration (for execution)
CREATE POLICY "Service role can update scheduled registrations"
  ON scheduled_registrations
  FOR UPDATE
  USING (auth.jwt()->>'role' = 'service_role');

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_scheduled_registrations_updated_at
  BEFORE UPDATE ON scheduled_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE scheduled_registrations IS 'Stores auto-registration requests for programs that open in the future';
COMMENT ON COLUMN scheduled_registrations.scheduled_time IS 'When to execute the registration (from Bookeo booking_opens_at)';
COMMENT ON COLUMN scheduled_registrations.event_id IS 'Bookeo slot eventId to book';
COMMENT ON COLUMN scheduled_registrations.delegate_data IS 'Responsible delegate information from form';
COMMENT ON COLUMN scheduled_registrations.participant_data IS 'Array of participant data from two-tier form';