-- Sensitive action gates and future delegated signup mandate foundation.
-- These web/backend tables do not change the public ChatGPT MCP tool surface.

CREATE TABLE IF NOT EXISTS public.parent_action_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signup_intent_id uuid REFERENCES public.signup_intents(id) ON DELETE SET NULL,
  autopilot_run_id uuid REFERENCES public.autopilot_runs(id) ON DELETE SET NULL,
  mandate_id uuid REFERENCES public.mandates(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  action_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_cents int,
  provider_key text,
  provider_readiness_level text,
  target_url text,
  exact_program text,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parent_action_confirmations_action_type_check CHECK (
    action_type IN (
      'register',
      'pay',
      'provider_login',
      'accept_waiver',
      'submit_final',
      'delegate_signup'
    )
  ),
  CONSTRAINT parent_action_confirmations_amount_check CHECK (
    amount_cents IS NULL OR amount_cents >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.agent_delegation_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signup_intent_id uuid REFERENCES public.signup_intents(id) ON DELETE SET NULL,
  autopilot_run_id uuid REFERENCES public.autopilot_runs(id) ON DELETE SET NULL,
  child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  provider_key text NOT NULL,
  provider_readiness_required text NOT NULL,
  target_program text NOT NULL,
  max_total_cents int NOT NULL,
  allowed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_delegation_mandates_status_check CHECK (
    status IN ('draft', 'active', 'revoked', 'expired', 'cancelled')
  ),
  CONSTRAINT agent_delegation_mandates_cap_check CHECK (max_total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_parent_action_confirmations_user_created
  ON public.parent_action_confirmations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_parent_action_confirmations_intent
  ON public.parent_action_confirmations(signup_intent_id);

CREATE INDEX IF NOT EXISTS idx_parent_action_confirmations_run
  ON public.parent_action_confirmations(autopilot_run_id);

CREATE INDEX IF NOT EXISTS idx_parent_action_confirmations_action_expiry
  ON public.parent_action_confirmations(action_type, expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_delegation_mandates_user_created
  ON public.agent_delegation_mandates(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_delegation_mandates_provider_status
  ON public.agent_delegation_mandates(provider_key, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_delegation_mandates_intent
  ON public.agent_delegation_mandates(signup_intent_id);

CREATE INDEX IF NOT EXISTS idx_agent_delegation_mandates_run
  ON public.agent_delegation_mandates(autopilot_run_id);

ALTER TABLE public.parent_action_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_delegation_mandates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Users can read their own parent confirmations"
  ON public.parent_action_confirmations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Users can create their own parent confirmations"
  ON public.parent_action_confirmations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      signup_intent_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.signup_intents i
        WHERE i.id = signup_intent_id
          AND i.user_id = auth.uid()
      )
    )
    AND (
      autopilot_run_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.autopilot_runs r
        WHERE r.id = autopilot_run_id
          AND r.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Users can update their own parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Users can update their own parent confirmations"
  ON public.parent_action_confirmations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Users can delete their own parent confirmations"
  ON public.parent_action_confirmations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Service role can manage parent confirmations"
  ON public.parent_action_confirmations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can read their own delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Users can read their own delegation mandates"
  ON public.agent_delegation_mandates
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Users can create their own delegation mandates"
  ON public.agent_delegation_mandates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      signup_intent_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.signup_intents i
        WHERE i.id = signup_intent_id
          AND i.user_id = auth.uid()
      )
    )
    AND (
      autopilot_run_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.autopilot_runs r
        WHERE r.id = autopilot_run_id
          AND r.user_id = auth.uid()
      )
    )
    AND (
      child_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.children c
        WHERE c.id = child_id
          AND c.user_id = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS "Users can update their own delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Users can update their own delegation mandates"
  ON public.agent_delegation_mandates
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Users can delete their own delegation mandates"
  ON public.agent_delegation_mandates
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Service role can manage delegation mandates"
  ON public.agent_delegation_mandates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
