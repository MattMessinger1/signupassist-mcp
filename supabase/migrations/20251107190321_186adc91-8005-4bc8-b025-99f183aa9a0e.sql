-- Create enhanced upsert function for cached programs with new fields
CREATE OR REPLACE FUNCTION public.upsert_cached_programs_enhanced(
  p_org_ref text,
  p_category text,
  p_programs_by_theme jsonb,
  p_prerequisites_schema jsonb DEFAULT '{}'::jsonb,
  p_questions_schema jsonb DEFAULT '{}'::jsonb,
  p_deep_links jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ttl_hours integer DEFAULT 24
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cache_id UUID;
  v_cache_key TEXT;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Generate cache key
  v_cache_key := p_org_ref || ':' || p_category;
  
  -- Calculate expiry time
  v_expires_at := now() + (p_ttl_hours || ' hours')::interval;
  
  -- Upsert cache entry with new fields
  INSERT INTO public.cached_programs (
    org_ref,
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
    p_category,
    v_cache_key,
    p_programs_by_theme,
    p_prerequisites_schema,
    p_questions_schema,
    p_deep_links,
    p_metadata,
    v_expires_at
  )
  ON CONFLICT (cache_key)
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
$function$;