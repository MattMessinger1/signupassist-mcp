-- Step 1: Enhance audit_events table with new columns
ALTER TABLE public.audit_events 
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_execution_id UUID REFERENCES public.plan_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS args_json JSONB,
  ADD COLUMN IF NOT EXISTS result_json JSONB,
  ADD COLUMN IF NOT EXISTS args_hash TEXT,
  ADD COLUMN IF NOT EXISTS result_hash TEXT,
  ADD COLUMN IF NOT EXISTS decision TEXT CHECK (decision IN ('pending', 'allowed', 'denied'));

-- Step 2: Rename tool_name to tool for consistency
ALTER TABLE public.audit_events RENAME COLUMN tool_name TO tool;

-- Step 3: Add performance indexes
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON public.audit_events (event_type);
CREATE INDEX IF NOT EXISTS audit_events_mandate_idx ON public.audit_events (mandate_id) WHERE mandate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_plan_idx ON public.audit_events (plan_id, plan_execution_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_events_user_idx ON public.audit_events (user_id) WHERE user_id IS NOT NULL;

-- Step 4: Migrate existing data from mcp_tool_calls to audit_events
INSERT INTO public.audit_events (
  event_type,
  provider,
  tool,
  mandate_id,
  plan_execution_id,
  args_json,
  result_json,
  args_hash,
  result_hash,
  decision,
  started_at,
  created_at
)
SELECT 
  'tool_call'::text as event_type,
  'unknown'::text as provider,
  tool,
  mandate_id,
  plan_execution_id,
  args_json,
  result_json,
  args_hash,
  result_hash,
  decision,
  ts as started_at,
  ts as created_at
FROM public.mcp_tool_calls
ON CONFLICT DO NOTHING;

-- Step 5: Drop the old mcp_tool_calls table
DROP TABLE IF EXISTS public.mcp_tool_calls;