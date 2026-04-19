-- Lock provider-learning raw tables and signup-intent audit events.
-- Raw discovery evidence is admin/service-owned. Parent-facing UI should use
-- redacted summaries, not direct authenticated reads from provider-learning tables.

ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_intent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read discovery_runs"
  ON public.discovery_runs;
DROP POLICY IF EXISTS "Authenticated users can read discovery_hints"
  ON public.discovery_hints;
DROP POLICY IF EXISTS "Authenticated users can read program_fingerprints"
  ON public.program_fingerprints;

DROP POLICY IF EXISTS "Users can create their own signup intent events"
  ON public.signup_intent_events;

REVOKE EXECUTE ON FUNCTION public.upsert_discovery_run(
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  numeric,
  uuid
) FROM PUBLIC, authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.get_best_hints(text, text, text)
  FROM PUBLIC, authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.refresh_best_hints()
  FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.upsert_discovery_run(
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  numeric,
  uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_best_hints(text, text, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.refresh_best_hints()
  TO service_role;

COMMENT ON TABLE public.discovery_runs IS
  'Provider-learning raw evidence table. Service-role/admin mediated access only; do not expose raw rows to parent clients.';

COMMENT ON TABLE public.discovery_hints IS
  'Provider-learning hint table. Service-role/admin mediated access only; do not expose raw hints to parent clients.';

COMMENT ON TABLE public.program_fingerprints IS
  'Provider-learning fingerprint table. Service-role/admin mediated access only; do not expose raw fingerprints to parent clients.';
