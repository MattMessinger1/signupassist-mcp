-- Create discovery_jobs table for async job processing
CREATE TABLE public.discovery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mandate_id UUID REFERENCES public.mandates(id),
  program_ref TEXT NOT NULL,
  credential_id UUID NOT NULL,
  child_name TEXT,
  mode TEXT DEFAULT 'full',
  
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Results (populated when complete)
  prerequisite_checks JSONB,
  program_questions JSONB,
  discovered_schema JSONB,
  metadata JSONB,
  
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create indexes for efficient querying
CREATE INDEX idx_discovery_jobs_user ON public.discovery_jobs(user_id);
CREATE INDEX idx_discovery_jobs_status ON public.discovery_jobs(status);
CREATE INDEX idx_discovery_jobs_created ON public.discovery_jobs(created_at DESC);

-- Enable RLS
ALTER TABLE public.discovery_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own discovery jobs"
  ON public.discovery_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own discovery jobs"
  ON public.discovery_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can update jobs (for background processing)
CREATE POLICY "Service role can update discovery jobs"
  ON public.discovery_jobs FOR UPDATE
  USING (true);

COMMENT ON TABLE public.discovery_jobs IS 'Tracks async discovery jobs to avoid edge function timeouts';