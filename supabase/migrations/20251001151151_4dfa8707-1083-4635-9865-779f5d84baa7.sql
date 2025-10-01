-- Create browser_sessions table for session caching
CREATE TABLE IF NOT EXISTS public.browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for fast lookups by session_key
CREATE INDEX IF NOT EXISTS idx_browser_sessions_key ON public.browser_sessions(session_key);

-- Create index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires ON public.browser_sessions(expires_at);

-- Auto-cleanup trigger for expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.browser_sessions 
  WHERE expires_at < now();
END;
$$;

-- Enable RLS
ALTER TABLE public.browser_sessions ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (used by MCP server)
CREATE POLICY "Service role has full access to browser_sessions"
ON public.browser_sessions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_browser_sessions_updated_at
  BEFORE UPDATE ON public.browser_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.browser_sessions IS 'Stores browser session state (cookies, localStorage) for reuse across multiple automation runs';
