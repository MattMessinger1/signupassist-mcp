-- Create a new table to track Field Discovery Status for individual programs
-- This prevents infinite retry loops for 404s and permanently failed programs

CREATE TABLE IF NOT EXISTS program_discovery_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_ref TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'skiclubpro',
  program_ref TEXT NOT NULL,
  discovery_status TEXT NOT NULL DEFAULT 'unknown',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one status row per program
  UNIQUE(org_ref, provider, program_ref),
  
  -- Validate status values
  CONSTRAINT check_discovery_status 
    CHECK (discovery_status IN ('ok', 'not_discoverable', 'temporary_error', 'unknown'))
);

-- Add indexes for efficient filtering
CREATE INDEX idx_program_discovery_org_ref ON program_discovery_status(org_ref, provider);
CREATE INDEX idx_program_discovery_status ON program_discovery_status(discovery_status);
CREATE INDEX idx_program_discovery_failures ON program_discovery_status(consecutive_failures) WHERE consecutive_failures > 0;

-- Add trigger to update updated_at
CREATE TRIGGER update_program_discovery_status_updated_at
  BEFORE UPDATE ON program_discovery_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add RLS policies
ALTER TABLE program_discovery_status ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role has full access to program_discovery_status"
  ON program_discovery_status
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read status
CREATE POLICY "Authenticated users can read program_discovery_status"
  ON program_discovery_status
  FOR SELECT
  USING (true);

-- Add helpful comments
COMMENT ON TABLE program_discovery_status IS 
'Tracks discovery status for individual programs to prevent infinite retry loops';

COMMENT ON COLUMN program_discovery_status.discovery_status IS 
'Discovery status: ok (success), not_discoverable (404/password), temporary_error (retry later), unknown (not yet attempted)';

COMMENT ON COLUMN program_discovery_status.consecutive_failures IS 
'Number of consecutive discovery failures - used to implement exponential backoff';

COMMENT ON COLUMN program_discovery_status.last_error IS 
'Last error message from discovery attempt - helps debug persistent failures';

COMMENT ON COLUMN program_discovery_status.last_attempt_at IS 
'Timestamp of last discovery attempt - used to determine when to retry temporary errors';