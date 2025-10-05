-- Discovery Learning Schema
-- This migration creates tables to track discovery runs, hints, and program fingerprints
-- for intelligent form field discovery and learning.

-- =============================================================================
-- TABLE: discovery_runs
-- Stores individual discovery run results for learning and debugging
-- =============================================================================
CREATE TABLE public.discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL,
  provider_slug text NOT NULL,
  program_key text NOT NULL,
  form_fingerprint text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prerequisites', 'program')),
  errors jsonb NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_confidence numeric NOT NULL DEFAULT 0 CHECK (run_confidence >= 0 AND run_confidence <= 1),
  UNIQUE(run_id, stage)
);

COMMENT ON TABLE public.discovery_runs IS 'Individual discovery run results for learning and analysis';
COMMENT ON COLUMN public.discovery_runs.run_id IS 'Correlation ID linking multiple discovery attempts';
COMMENT ON COLUMN public.discovery_runs.form_fingerprint IS 'Hash of form structure for matching similar forms';
COMMENT ON COLUMN public.discovery_runs.stage IS 'Discovery stage: prerequisites or program';
COMMENT ON COLUMN public.discovery_runs.errors IS 'Sanitized error messages encountered during discovery';
COMMENT ON COLUMN public.discovery_runs.run_confidence IS 'Confidence score for this specific run (0-1)';

-- =============================================================================
-- TABLE: discovery_hints
-- Aggregated hints for field discovery, updated via upsert
-- =============================================================================
CREATE TABLE public.discovery_hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_slug text NOT NULL,
  program_key text NOT NULL,
  form_fingerprint text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prerequisites', 'program')),
  hints jsonb NOT NULL,
  samples_count int NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  UNIQUE(provider_slug, program_key, form_fingerprint, stage)
);

COMMENT ON TABLE public.discovery_hints IS 'Aggregated discovery hints for specific provider/program/form combinations';
COMMENT ON COLUMN public.discovery_hints.hints IS 'Learned patterns and strategies for field discovery';
COMMENT ON COLUMN public.discovery_hints.samples_count IS 'Number of discovery runs contributing to these hints';
COMMENT ON COLUMN public.discovery_hints.confidence IS 'Aggregate confidence score based on sample success rate';

-- =============================================================================
-- TABLE: program_fingerprints
-- Tracks form fingerprints to detect program changes
-- =============================================================================
CREATE TABLE public.program_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_slug text NOT NULL,
  program_key text NOT NULL,
  form_fingerprint text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('prerequisites', 'program')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  hit_count int NOT NULL DEFAULT 0,
  UNIQUE(provider_slug, program_key, form_fingerprint, stage)
);

COMMENT ON TABLE public.program_fingerprints IS 'Tracks form fingerprints to detect when programs change their structure';
COMMENT ON COLUMN public.program_fingerprints.hit_count IS 'Number of times this fingerprint has been encountered';
COMMENT ON COLUMN public.program_fingerprints.last_seen_at IS 'Most recent discovery run using this fingerprint';

-- =============================================================================
-- INDEXES
-- Performance indexes for common query patterns
-- =============================================================================
CREATE INDEX idx_discovery_runs_provider_program_stage 
  ON public.discovery_runs(provider_slug, program_key, stage);

CREATE INDEX idx_discovery_runs_run_id 
  ON public.discovery_runs(run_id);

CREATE INDEX idx_discovery_hints_provider_program_stage 
  ON public.discovery_hints(provider_slug, program_key, stage);

CREATE INDEX idx_program_fingerprints_provider_program_stage 
  ON public.program_fingerprints(provider_slug, program_key, stage);

-- =============================================================================
-- MATERIALIZED VIEW: discovery_best_hints
-- Pre-computed best hints per provider/program/stage combination
-- =============================================================================
CREATE MATERIALIZED VIEW public.discovery_best_hints AS
SELECT DISTINCT ON (provider_slug, program_key, stage)
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
ORDER BY 
  provider_slug,
  program_key,
  stage,
  confidence DESC,
  samples_count DESC,
  updated_at DESC;

COMMENT ON MATERIALIZED VIEW public.discovery_best_hints IS 'Best hints per provider/program/stage - refresh periodically';

CREATE UNIQUE INDEX idx_discovery_best_hints_unique 
  ON public.discovery_best_hints(provider_slug, program_key, stage);

-- =============================================================================
-- FUNCTION: sanitize_error_text
-- Strips PII (emails, phone numbers, credit cards) from error messages
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sanitize_error_text(txt text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
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

COMMENT ON FUNCTION public.sanitize_error_text IS 'Removes PII from error messages before storage';

-- =============================================================================
-- FUNCTION STUB: merge_hints
-- Merges existing hints with new hints (implementation TBD)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.merge_hints(existing jsonb, newest jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Stub: will implement merging logic in next migration
  -- Strategy: combine patterns, deduplicate selectors, weight by success rate
  RETURN existing || newest;
END;
$$;

COMMENT ON FUNCTION public.merge_hints IS 'Merges existing hints with new hints - STUB implementation';

-- =============================================================================
-- FUNCTION STUB: recompute_confidence
-- Recalculates confidence based on sample count and success rates
-- =============================================================================
CREATE OR REPLACE FUNCTION public.recompute_confidence(samples int, prev numeric, latest numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
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

COMMENT ON FUNCTION public.recompute_confidence IS 'Recomputes confidence score - STUB implementation';

-- =============================================================================
-- RLS POLICY COMMENTS
-- No RLS enabled yet (no PII in these tables), but prepared for future
-- =============================================================================

COMMENT ON TABLE public.discovery_runs IS 
  'RLS TODO: If linking to user_id, add policy: users can view their own runs';

COMMENT ON TABLE public.discovery_hints IS 
  'RLS TODO: Generally read-only for all authenticated users, write via service role';

COMMENT ON TABLE public.program_fingerprints IS 
  'RLS TODO: Read-only for all authenticated users, write via service role';

-- Note: These tables contain no PII and are used for system learning.
-- If user-specific data is added later, enable RLS with appropriate policies.