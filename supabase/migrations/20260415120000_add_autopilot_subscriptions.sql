-- SignupAssist V1 supervised autopilot subscription and run foundation.
-- This is intentionally additive so the existing success-fee and scheduled
-- registration flows keep their current tables and behavior.

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'inactive',
  plan_id TEXT NOT NULL DEFAULT 'signupassist_autopilot_monthly',
  price_cents INTEGER NOT NULL DEFAULT 900,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer_id
  ON public.user_subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status
  ON public.user_subscriptions(status);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscription"
  ON public.user_subscriptions;

CREATE POLICY "Users can view their own subscription"
  ON public.user_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.autopilot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_program TEXT,
  child_id UUID REFERENCES public.children(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  confidence TEXT NOT NULL DEFAULT 'beta',
  caps JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_runs_user_id
  ON public.autopilot_runs(user_id);

CREATE INDEX IF NOT EXISTS idx_autopilot_runs_status
  ON public.autopilot_runs(status);

CREATE INDEX IF NOT EXISTS idx_autopilot_runs_provider_key
  ON public.autopilot_runs(provider_key);

ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own autopilot runs"
  ON public.autopilot_runs;

CREATE POLICY "Users can view their own autopilot runs"
  ON public.autopilot_runs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own autopilot runs"
  ON public.autopilot_runs;

CREATE POLICY "Users can create their own autopilot runs"
  ON public.autopilot_runs
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.user_subscriptions s
      WHERE s.user_id = auth.uid()
        AND (
          s.status IN ('active', 'trialing')
          OR (
            s.status = 'canceled'
            AND s.cancel_at_period_end = true
            AND s.current_period_end > now()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users can update their own autopilot runs"
  ON public.autopilot_runs;

CREATE POLICY "Users can update their own autopilot runs"
  ON public.autopilot_runs
  FOR UPDATE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at
  ON public.user_subscriptions;

CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_autopilot_runs_updated_at
  ON public.autopilot_runs;

CREATE TRIGGER update_autopilot_runs_updated_at
  BEFORE UPDATE ON public.autopilot_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
