-- Web-only Signup Intent bridge.
-- Keeps Activity Finder -> Autopilot handoff server-side without changing MCP tools.

CREATE TABLE IF NOT EXISTS public.signup_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'activity_finder',
  original_query text,
  parsed_activity text,
  parsed_venue text,
  parsed_city text,
  parsed_state text,
  parsed_age_years int,
  parsed_grade text,
  selected_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_url text,
  provider_key text,
  provider_name text,
  finder_status text,
  confidence numeric,
  source_freshness text,
  selected_child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  autopilot_run_id uuid REFERENCES public.autopilot_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_intents_status_check CHECK (
    status IN (
      'draft',
      'needs_profile',
      'ready_for_autopilot',
      'scheduled',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  CONSTRAINT signup_intents_age_check CHECK (
    parsed_age_years IS NULL OR (parsed_age_years >= 0 AND parsed_age_years <= 19)
  )
);

CREATE TABLE IF NOT EXISTS public.signup_intent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_intent_id uuid NOT NULL REFERENCES public.signup_intents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_intents_user_created
  ON public.signup_intents(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_intents_status
  ON public.signup_intents(status);

CREATE INDEX IF NOT EXISTS idx_signup_intent_events_intent_created
  ON public.signup_intent_events(signup_intent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_intent_events_user_created
  ON public.signup_intent_events(user_id, created_at DESC);

ALTER TABLE public.signup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_intent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own signup intents"
  ON public.signup_intents;

CREATE POLICY "Users can read their own signup intents"
  ON public.signup_intents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own signup intents"
  ON public.signup_intents;

CREATE POLICY "Users can create their own signup intents"
  ON public.signup_intents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      selected_child_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.children c
        WHERE c.id = selected_child_id
          AND c.user_id = auth.uid()
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

DROP POLICY IF EXISTS "Users can update their own signup intents"
  ON public.signup_intents;

CREATE POLICY "Users can update their own signup intents"
  ON public.signup_intents
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      selected_child_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.children c
        WHERE c.id = selected_child_id
          AND c.user_id = auth.uid()
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

DROP POLICY IF EXISTS "Users can delete their own signup intents"
  ON public.signup_intents;

CREATE POLICY "Users can delete their own signup intents"
  ON public.signup_intents
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own signup intent events"
  ON public.signup_intent_events;

CREATE POLICY "Users can read their own signup intent events"
  ON public.signup_intent_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own signup intent events"
  ON public.signup_intent_events;

CREATE POLICY "Users can create their own signup intent events"
  ON public.signup_intent_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.signup_intents i
      WHERE i.id = signup_intent_id
        AND i.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_signup_intents_updated_at
  ON public.signup_intents;

CREATE TRIGGER update_signup_intents_updated_at
  BEFORE UPDATE ON public.signup_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
