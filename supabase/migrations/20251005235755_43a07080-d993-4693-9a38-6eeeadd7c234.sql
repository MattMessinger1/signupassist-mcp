-- Fix security warnings from discovery learning tables migration

-- =============================================================================
-- FIX: Set search_path on functions for security
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sanitize_error_text(txt text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF txt IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Remove email addresses
  txt := regexp_replace(txt, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}', '[EMAIL]', 'g');
  
  -- Remove phone numbers (various formats)
  txt := regexp_replace(txt, '\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', '[PHONE]', 'g');
  txt := regexp_replace(txt, '\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}', '[PHONE]', 'g');
  
  -- Remove 13-19 digit runs (credit card numbers)
  txt := regexp_replace(txt, '\d{13,19}', '[CC]', 'g');
  
  RETURN txt;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_hints(existing jsonb, newest jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- Stub: will implement merging logic in next migration
  -- Strategy: combine patterns, deduplicate selectors, weight by success rate
  RETURN existing || newest;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_confidence(samples int, prev numeric, latest numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  -- Stub: will implement Bayesian/weighted average in next migration
  -- Strategy: weighted moving average with decay for old samples
  IF samples = 0 THEN
    RETURN 0;
  END IF;
  RETURN LEAST(1.0, GREATEST(0.0, (prev + latest) / 2.0));
END;
$$;

-- =============================================================================
-- FIX: Enable RLS on all discovery learning tables
-- These tables contain no PII and are used for system learning.
-- Service role can write, authenticated users can read (for debugging/analysis)
-- =============================================================================

ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_hints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_fingerprints ENABLE ROW LEVEL SECURITY;

-- Service role has full access to all discovery tables
CREATE POLICY "Service role has full access to discovery_runs"
  ON public.discovery_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to discovery_hints"
  ON public.discovery_hints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to program_fingerprints"
  ON public.program_fingerprints
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read for debugging and analysis
CREATE POLICY "Authenticated users can read discovery_runs"
  ON public.discovery_runs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read discovery_hints"
  ON public.discovery_hints
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read program_fingerprints"
  ON public.program_fingerprints
  FOR SELECT
  TO authenticated
  USING (true);

-- =============================================================================
-- FIX: Remove materialized view from public API schema
-- Materialized views should not be directly accessible via PostgREST
-- Applications should query discovery_hints directly with appropriate filtering
-- =============================================================================

-- Drop the materialized view since it's flagged as a security concern
-- Applications can query discovery_hints with ORDER BY to get best hints
DROP MATERIALIZED VIEW IF EXISTS public.discovery_best_hints;

-- Instead, create a regular function that returns the best hints
-- This gives us control over access via RLS on the underlying table
CREATE OR REPLACE FUNCTION public.get_best_hints(
  p_provider_slug text,
  p_program_key text,
  p_stage text
)
RETURNS TABLE (
  id uuid,
  provider_slug text,
  program_key text,
  form_fingerprint text,
  stage text,
  hints jsonb,
  samples_count int,
  confidence numeric,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    provider_slug,
    program_key,
    form_fingerprint,
    stage,
    hints,
    samples_count,
    confidence,
    updated_at
  FROM public.discovery_hints
  WHERE discovery_hints.provider_slug = p_provider_slug
    AND discovery_hints.program_key = p_program_key
    AND discovery_hints.stage = p_stage
  ORDER BY 
    confidence DESC,
    samples_count DESC,
    updated_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_best_hints IS 'Returns the best discovery hints for a specific provider/program/stage combination';