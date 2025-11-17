-- Create table for individual program cache with prerequisites and signup forms
CREATE TABLE IF NOT EXISTS public.cached_provider_feed (
  org_ref TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  category TEXT,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  program JSONB NOT NULL,              -- normalized program data
  prerequisites JSONB,                 -- membership, waivers, payment, children
  signup_form JSONB,                   -- parsed dynamic form schema
  PRIMARY KEY (org_ref, program_ref)
);

-- Create index for faster lookups by organization
CREATE INDEX IF NOT EXISTS idx_cached_feed_orgref ON public.cached_provider_feed (org_ref);

-- Enable RLS
ALTER TABLE public.cached_provider_feed ENABLE ROW LEVEL SECURITY;

-- Allow public read access (similar to cached_programs)
CREATE POLICY "Public users can read cached provider feed"
  ON public.cached_provider_feed
  FOR SELECT
  USING (true);

-- Service role has full access for cache management
CREATE POLICY "Service role has full access to cached provider feed"
  ON public.cached_provider_feed
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create upsert function for cache management
CREATE OR REPLACE FUNCTION public.upsert_cached_provider_feed (
  p_org_ref TEXT,
  p_program_ref TEXT,
  p_category TEXT,
  p_program JSONB,
  p_prereq JSONB,
  p_signup_form JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.cached_provider_feed (
    org_ref, program_ref, category, program, prerequisites, signup_form, cached_at
  ) VALUES (
    p_org_ref, p_program_ref, p_category, p_program, p_prereq, p_signup_form, NOW()
  )
  ON CONFLICT (org_ref, program_ref)
  DO UPDATE SET
    program        = EXCLUDED.program,
    prerequisites  = EXCLUDED.prerequisites,
    signup_form    = EXCLUDED.signup_form,
    category       = EXCLUDED.category,
    cached_at      = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;