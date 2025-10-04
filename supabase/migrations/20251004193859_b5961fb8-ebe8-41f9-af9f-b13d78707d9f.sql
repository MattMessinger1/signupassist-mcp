-- Create execution_logs table for structured logging
CREATE TABLE IF NOT EXISTS public.execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE CASCADE,
  plan_execution_id UUID REFERENCES public.plan_executions(id) ON DELETE CASCADE,
  mandate_id UUID REFERENCES public.mandates(id) ON DELETE CASCADE,
  
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout')),
  attempt INTEGER NOT NULL DEFAULT 1,
  
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their execution logs" ON public.execution_logs;
DROP POLICY IF EXISTS "Service role has full access to execution_logs" ON public.execution_logs;

-- Users can view their own execution logs
CREATE POLICY "Users can view their execution logs"
ON public.execution_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.plans p
    WHERE p.id = execution_logs.plan_id
    AND p.user_id = auth.uid()
  )
);

-- Service role has full access
CREATE POLICY "Service role has full access to execution_logs"
ON public.execution_logs
FOR ALL
USING (true)
WITH CHECK (true);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_execution_logs_correlation_id ON public.execution_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_plan_id ON public.execution_logs(plan_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at ON public.execution_logs(created_at DESC);

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_execution_logs_updated_at ON public.execution_logs;

-- Add trigger for updated_at
CREATE TRIGGER update_execution_logs_updated_at
BEFORE UPDATE ON public.execution_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create RPC function to insert execution logs
CREATE OR REPLACE FUNCTION public.insert_execution_log(
  p_correlation_id UUID,
  p_plan_id UUID,
  p_plan_execution_id UUID DEFAULT NULL,
  p_mandate_id UUID DEFAULT NULL,
  p_stage TEXT DEFAULT 'unknown',
  p_status TEXT DEFAULT 'pending',
  p_attempt INTEGER DEFAULT 1,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.execution_logs (
    correlation_id,
    plan_id,
    plan_execution_id,
    mandate_id,
    stage,
    status,
    attempt,
    error_message,
    metadata
  ) VALUES (
    p_correlation_id,
    p_plan_id,
    p_plan_execution_id,
    p_mandate_id,
    p_stage,
    p_status,
    p_attempt,
    p_error_message,
    p_metadata
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;