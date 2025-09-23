-- Phase 1: Mandates and Audit Trail Tables

-- Children table
CREATE TABLE IF NOT EXISTS public.children (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    dob DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mandates table  
CREATE TABLE IF NOT EXISTS public.mandates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    scope TEXT[] NOT NULL,
    max_amount_cents INTEGER,
    child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
    program_ref TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ NOT NULL,
    jws_compact TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plans table
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
    program_ref TEXT NOT NULL,
    opens_at TIMESTAMPTZ NOT NULL,
    mandate_id UUID REFERENCES public.mandates(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plan executions table
CREATE TABLE IF NOT EXISTS public.plan_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    result TEXT,
    confirmation_ref TEXT,
    amount_cents INTEGER
);

-- MCP tool calls table (audit trail)
CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_execution_id UUID NOT NULL REFERENCES public.plan_executions(id) ON DELETE CASCADE,
    mandate_id UUID NOT NULL REFERENCES public.mandates(id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    args_json JSONB,
    result_json JSONB,
    args_hash TEXT,
    result_hash TEXT,
    decision TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence assets table
CREATE TABLE IF NOT EXISTS public.evidence_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_execution_id UUID NOT NULL REFERENCES public.plan_executions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    url TEXT,
    sha256 TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Charges table
CREATE TABLE IF NOT EXISTS public.charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_execution_id UUID NOT NULL REFERENCES public.plan_executions(id) ON DELETE CASCADE,
    stripe_payment_intent TEXT,
    amount_cents INTEGER,
    charged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mandates_user_id ON public.mandates(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_executions_plan_id ON public.plan_executions(plan_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_plan_execution_id ON public.mcp_tool_calls(plan_execution_id);
CREATE INDEX IF NOT EXISTS idx_evidence_assets_plan_execution_id ON public.evidence_assets(plan_execution_id);
CREATE INDEX IF NOT EXISTS idx_charges_plan_execution_id ON public.charges(plan_execution_id);

-- Enable Row Level Security
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage their own children" ON public.children
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own mandates" ON public.mandates
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own plans" ON public.plans
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view their plan executions" ON public.plan_executions
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.plans WHERE plans.id = plan_executions.plan_id AND plans.user_id = auth.uid()
    ));

CREATE POLICY "Users can view their MCP tool calls" ON public.mcp_tool_calls
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.plan_executions pe 
        JOIN public.plans p ON p.id = pe.plan_id 
        WHERE pe.id = mcp_tool_calls.plan_execution_id AND p.user_id = auth.uid()
    ));

CREATE POLICY "Users can view their evidence assets" ON public.evidence_assets
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.plan_executions pe 
        JOIN public.plans p ON p.id = pe.plan_id 
        WHERE pe.id = evidence_assets.plan_execution_id AND p.user_id = auth.uid()
    ));

CREATE POLICY "Users can view their charges" ON public.charges
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.plan_executions pe 
        JOIN public.plans p ON p.id = pe.plan_id 
        WHERE pe.id = charges.plan_execution_id AND p.user_id = auth.uid()
    ));