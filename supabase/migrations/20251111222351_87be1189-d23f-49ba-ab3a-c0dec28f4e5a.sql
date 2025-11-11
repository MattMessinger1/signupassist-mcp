-- Add provider column to cached_programs table
-- This enables multi-provider cache support

-- Step 1: Add provider column with default value
ALTER TABLE public.cached_programs 
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'skiclubpro';

-- Step 2: Add comment to explain the column
COMMENT ON COLUMN public.cached_programs.provider IS 'Provider identifier (skiclubpro, campminder, daysmart, etc.)';

-- Step 3: Create index on provider for faster queries
CREATE INDEX IF NOT EXISTS idx_cached_programs_provider 
  ON public.cached_programs(provider);

-- Step 4: Create composite index on org_ref and provider
CREATE INDEX IF NOT EXISTS idx_cached_programs_org_provider 
  ON public.cached_programs(org_ref, provider);

-- Step 5: Update the unique constraint to include provider
-- First drop the old unique constraint (not just the index)
ALTER TABLE public.cached_programs 
  DROP CONSTRAINT IF EXISTS cached_programs_cache_key_key;

-- Create new unique constraint with provider
ALTER TABLE public.cached_programs 
  ADD CONSTRAINT cached_programs_cache_key_provider_key 
  UNIQUE (cache_key, provider);

-- Step 6: Update the find_programs_cached function to be provider-aware
CREATE OR REPLACE FUNCTION public.find_programs_cached(
  p_org_ref TEXT,
  p_category TEXT,
  p_provider TEXT DEFAULT 'skiclubpro',
  p_max_age_hours INTEGER DEFAULT 24
) RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_cache_age_limit TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Calculate cache age limit
  v_cache_age_limit := now() - (p_max_age_hours || ' hours')::interval;
  
  -- Find most recent non-expired cache entry for this provider
  SELECT programs_by_theme
  INTO v_result
  FROM public.cached_programs
  WHERE org_ref = p_org_ref
    AND provider = p_provider
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

-- Step 7: Update the upsert_cached_programs_enhanced function to be provider-aware
CREATE OR REPLACE FUNCTION public.upsert_cached_programs_enhanced(
  p_org_ref TEXT,
  p_category TEXT,
  p_programs_by_theme JSONB,
  p_provider TEXT DEFAULT 'skiclubpro',
  p_prerequisites_schema JSONB DEFAULT '{}'::jsonb,
  p_questions_schema JSONB DEFAULT '{}'::jsonb,
  p_deep_links JSONB DEFAULT '{}'::jsonb,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_ttl_hours INTEGER DEFAULT 24
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cache_id UUID;
  v_cache_key TEXT;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Generate cache key with provider
  v_cache_key := p_org_ref || ':' || p_category || ':' || p_provider;
  
  -- Calculate expiry time
  v_expires_at := now() + (p_ttl_hours || ' hours')::interval;
  
  -- Upsert cache entry with provider field
  INSERT INTO public.cached_programs (
    org_ref,
    provider,
    category,
    cache_key,
    programs_by_theme,
    prerequisites_schema,
    questions_schema,
    deep_links,
    metadata,
    expires_at
  ) VALUES (
    p_org_ref,
    p_provider,
    p_category,
    v_cache_key,
    p_programs_by_theme,
    p_prerequisites_schema,
    p_questions_schema,
    p_deep_links,
    p_metadata,
    v_expires_at
  )
  ON CONFLICT (cache_key, provider)
  DO UPDATE SET
    programs_by_theme = EXCLUDED.programs_by_theme,
    prerequisites_schema = EXCLUDED.prerequisites_schema,
    questions_schema = EXCLUDED.questions_schema,
    deep_links = EXCLUDED.deep_links,
    metadata = EXCLUDED.metadata,
    cached_at = now(),
    expires_at = EXCLUDED.expires_at,
    updated_at = now()
  RETURNING id INTO v_cache_id;
  
  RETURN v_cache_id;
END;
$$;

-- Step 8: Update cleanup function to be provider-aware
CREATE OR REPLACE FUNCTION public.cleanup_expired_program_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete expired cache entries (all providers)
  WITH deleted AS (
    DELETE FROM public.cached_programs
    WHERE expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
END;
$$;