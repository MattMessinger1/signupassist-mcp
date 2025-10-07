-- Fix RLS policies for discovery_jobs INSERT
DROP POLICY IF EXISTS "Users can insert their own discovery jobs" ON public.discovery_jobs;
DROP POLICY IF EXISTS "Service role can insert discovery jobs" ON public.discovery_jobs;

-- Users can insert their own jobs
CREATE POLICY "Users can insert their own discovery jobs"
  ON public.discovery_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to discovery jobs"
  ON public.discovery_jobs FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "Users can insert their own discovery jobs" ON public.discovery_jobs 
  IS 'Users can create discovery jobs for themselves';