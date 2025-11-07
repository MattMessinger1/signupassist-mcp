-- ============================================================================
-- Task 4-6: Program Cache Infrastructure (Fixed)
-- Creates cached_programs table and find_programs_cached() RPC function
-- ============================================================================

-- Create cached_programs table
CREATE TABLE IF NOT EXISTS public.cached_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_ref TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'all',
  cache_key TEXT NOT NULL UNIQUE,
  programs_by_theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add indexes for fast lookups (removed partial index with now())
CREATE INDEX IF NOT EXISTS idx_cached_programs_org_category 
  ON public.cached_programs(org_ref, category);
CREATE INDEX IF NOT EXISTS idx_cached_programs_cache_key 
  ON public.cached_programs(cache_key);
CREATE INDEX IF NOT EXISTS idx_cached_programs_expires_at 
  ON public.cached_programs(expires_at);

-- Enable RLS
ALTER TABLE public.cached_programs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Service role has full access (for cron jobs)
CREATE POLICY "Service role has full access to cached_programs"
  ON public.cached_programs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read public cache data
CREATE POLICY "Authenticated users can read cached programs"
  ON public.cached_programs
  FOR SELECT
  TO authenticated
  USING (true);

-- Public users can read public cache data (for unauthenticated flows)
CREATE POLICY "Public users can read cached programs"
  ON public.cached_programs
  FOR SELECT
  TO anon
  USING (true);

-- Auto-update updated_at trigger
CREATE TRIGGER update_cached_programs_updated_at
  BEFORE UPDATE ON public.cached_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- RPC Function: find_programs_cached
-- Fast lookup function for cached program data
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_programs_cached(
  p_org_ref TEXT,
  p_category TEXT DEFAULT 'all',
  p_max_age_hours INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_cache_age_limit TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Calculate cache age limit
  v_cache_age_limit := now() - (p_max_age_hours || ' hours')::interval;
  
  -- Find most recent non-expired cache entry
  SELECT programs_by_theme
  INTO v_result
  FROM public.cached_programs
  WHERE org_ref = p_org_ref
    AND category = p_category
    AND expires_at > now()
    AND cached_at > v_cache_age_limit
  ORDER BY cached_at DESC
  LIMIT 1;
  
  -- Return empty object if no cache found
  IF v_result IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  
  RETURN v_result;
END;
$$;

-- ============================================================================
-- Helper Function: upsert_cached_programs
-- Upserts program cache with automatic expiry calculation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_cached_programs(
  p_org_ref TEXT,
  p_category TEXT,
  p_programs_by_theme JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_hours INTEGER DEFAULT 24
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cache_id UUID;
  v_cache_key TEXT;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Generate cache key
  v_cache_key := p_org_ref || ':' || p_category;
  
  -- Calculate expiry time
  v_expires_at := now() + (p_ttl_hours || ' hours')::interval;
  
  -- Upsert cache entry
  INSERT INTO public.cached_programs (
    org_ref,
    category,
    cache_key,
    programs_by_theme,
    metadata,
    expires_at
  ) VALUES (
    p_org_ref,
    p_category,
    v_cache_key,
    p_programs_by_theme,
    p_metadata,
    v_expires_at
  )
  ON CONFLICT (cache_key)
  DO UPDATE SET
    programs_by_theme = EXCLUDED.programs_by_theme,
    metadata = EXCLUDED.metadata,
    cached_at = now(),
    expires_at = EXCLUDED.expires_at,
    updated_at = now()
  RETURNING id INTO v_cache_id;
  
  RETURN v_cache_id;
END;
$$;

-- ============================================================================
-- Cleanup Function: cleanup_expired_program_cache
-- Removes expired cache entries (called by cron job)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_program_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete expired cache entries
  WITH deleted AS (
    DELETE FROM public.cached_programs
    WHERE expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.find_programs_cached(TEXT, TEXT, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.upsert_cached_programs(TEXT, TEXT, JSONB, JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_program_cache() TO service_role;