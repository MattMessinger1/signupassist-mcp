CREATE TABLE IF NOT EXISTS public.activity_finder_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  raw_query text NOT NULL,
  parsed_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  location_hint jsonb,
  best_match jsonb,
  selected_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_finder_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own activity finder searches" ON public.activity_finder_searches;
CREATE POLICY "Users can read their own activity finder searches"
  ON public.activity_finder_searches
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own activity finder searches" ON public.activity_finder_searches;
CREATE POLICY "Users can insert their own activity finder searches"
  ON public.activity_finder_searches
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own selected activity finder result" ON public.activity_finder_searches;
CREATE POLICY "Users can update their own selected activity finder result"
  ON public.activity_finder_searches
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_activity_finder_searches_user_created
  ON public.activity_finder_searches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_finder_searches_created
  ON public.activity_finder_searches(created_at DESC);
