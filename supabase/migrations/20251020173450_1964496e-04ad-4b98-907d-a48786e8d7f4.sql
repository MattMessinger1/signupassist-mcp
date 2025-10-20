-- Create agentic_checkout_sessions table for session context
CREATE TABLE IF NOT EXISTS public.agentic_checkout_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  state JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agentic_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own sessions
CREATE POLICY "Users can manage their own sessions"
  ON public.agentic_checkout_sessions
  FOR ALL
  USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_agentic_checkout_sessions_updated_at
  BEFORE UPDATE ON public.agentic_checkout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster lookups
CREATE INDEX idx_agentic_checkout_sessions_user_id ON public.agentic_checkout_sessions(user_id);
CREATE INDEX idx_agentic_checkout_sessions_provider_id ON public.agentic_checkout_sessions(provider_id);