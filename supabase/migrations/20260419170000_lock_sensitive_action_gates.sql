-- Lock sensitive-action confirmation and delegation-mandate writes to trusted server code.
-- Parents may read their own records, but user clients cannot self-create,
-- self-confirm, self-consume, revoke, or delete trusted gate records.

ALTER TABLE public.parent_action_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_delegation_mandates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create their own parent confirmations"
  ON public.parent_action_confirmations;

DROP POLICY IF EXISTS "Users can update their own parent confirmations"
  ON public.parent_action_confirmations;

DROP POLICY IF EXISTS "Users can delete their own parent confirmations"
  ON public.parent_action_confirmations;

DROP POLICY IF EXISTS "Users can create their own delegation mandates"
  ON public.agent_delegation_mandates;

DROP POLICY IF EXISTS "Users can update their own delegation mandates"
  ON public.agent_delegation_mandates;

DROP POLICY IF EXISTS "Users can delete their own delegation mandates"
  ON public.agent_delegation_mandates;

DROP POLICY IF EXISTS "Service role can manage parent confirmations"
  ON public.parent_action_confirmations;

CREATE POLICY "Service role can manage parent confirmations"
  ON public.parent_action_confirmations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage delegation mandates"
  ON public.agent_delegation_mandates;

CREATE POLICY "Service role can manage delegation mandates"
  ON public.agent_delegation_mandates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.parent_action_confirmations IS
  'Server-managed one-time confirmations for sensitive SignupAssist actions. User clients may read their own records but cannot create, confirm, consume, or delete them directly.';

COMMENT ON TABLE public.agent_delegation_mandates IS
  'Server-managed future delegation mandates. User clients may read their own records but cannot create active trusted mandates directly.';
