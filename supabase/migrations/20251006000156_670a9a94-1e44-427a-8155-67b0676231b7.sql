-- Discovery Learning RPCs
-- Remote procedure calls for managing discovery runs and hints

-- =============================================================================
-- Drop existing get_best_hints function to change return type
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_best_hints(text, text, text);

-- =============================================================================
-- RPC: get_best_hints
-- Returns the best available hints for a given provider/program/stage
-- Returns empty jsonb object if no hints found
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_best_hints(
  p_provider text,
  p_program text,
  p_stage text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Query discovery_hints for the best match
  SELECT jsonb_build_object(
    'provider', provider_slug,
    'program', program_key,
    'stage', stage,
    'fingerprint', form_fingerprint,
    'hints', hints,
    'confidence', confidence,
    'samples_count', samples_count
  )
  INTO v_result
  FROM public.discovery_hints
  WHERE provider_slug = p_provider
    AND program_key = p_program
    AND stage = p_stage
  ORDER BY 
    confidence DESC,
    samples_count DESC,
    updated_at DESC
  LIMIT 1;
  
  -- Return empty object if no hints found
  IF v_result IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_best_hints IS 
  'Returns best discovery hints for provider/program/stage or empty object if none found';

-- =============================================================================
-- RPC: upsert_discovery_run
-- Records a discovery run and updates hints/fingerprints accordingly
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_discovery_run(
  p_provider text,
  p_program text,
  p_fingerprint text,
  p_stage text,
  p_errors jsonb,
  p_meta jsonb,
  p_run_conf numeric,
  p_run_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_discovery_run_id uuid;
  v_sanitized_errors jsonb;
  v_existing_hints jsonb;
  v_existing_confidence numeric;
  v_existing_samples int;
  v_new_hints jsonb;
  v_merged_hints jsonb;
  v_new_confidence numeric;
BEGIN
  -- Sanitize error messages in the errors jsonb
  -- Assumes errors is an array of objects with 'message' field
  IF p_errors IS NOT NULL AND jsonb_typeof(p_errors) = 'array' THEN
    SELECT jsonb_agg(
      CASE 
        WHEN jsonb_typeof(elem) = 'object' AND elem ? 'message' THEN
          jsonb_set(elem, '{message}', to_jsonb(public.sanitize_error_text(elem->>'message')))
        ELSE
          elem
      END
    )
    INTO v_sanitized_errors
    FROM jsonb_array_elements(p_errors) AS elem;
  ELSE
    v_sanitized_errors := p_errors;
  END IF;
  
  -- 1) Insert into discovery_runs
  INSERT INTO public.discovery_runs (
    run_id,
    provider_slug,
    program_key,
    form_fingerprint,
    stage,
    errors,
    meta,
    run_confidence
  ) VALUES (
    p_run_id,
    p_provider,
    p_program,
    p_fingerprint,
    p_stage,
    COALESCE(v_sanitized_errors, '[]'::jsonb),
    COALESCE(p_meta, '{}'::jsonb),
    p_run_conf
  )
  RETURNING id INTO v_discovery_run_id;
  
  -- 2) Upsert program_fingerprints (bump hit_count, update last_seen_at)
  INSERT INTO public.program_fingerprints (
    provider_slug,
    program_key,
    form_fingerprint,
    stage,
    last_seen_at,
    hit_count
  ) VALUES (
    p_provider,
    p_program,
    p_fingerprint,
    p_stage,
    now(),
    1
  )
  ON CONFLICT (provider_slug, program_key, form_fingerprint, stage)
  DO UPDATE SET
    last_seen_at = now(),
    hit_count = program_fingerprints.hit_count + 1;
  
  -- 3) Upsert discovery_hints
  -- Extract hints from meta (assuming meta contains a 'hints' field)
  v_new_hints := p_meta -> 'hints';
  
  -- If no hints in meta, skip hint upsertion
  IF v_new_hints IS NULL THEN
    RETURN v_discovery_run_id;
  END IF;
  
  -- Get existing hints if any
  SELECT hints, confidence, samples_count
  INTO v_existing_hints, v_existing_confidence, v_existing_samples
  FROM public.discovery_hints
  WHERE provider_slug = p_provider
    AND program_key = p_program
    AND form_fingerprint = p_fingerprint
    AND stage = p_stage;
  
  -- Merge hints and recompute confidence
  IF v_existing_hints IS NOT NULL THEN
    v_merged_hints := public.merge_hints(v_existing_hints, v_new_hints);
    v_new_confidence := public.recompute_confidence(
      v_existing_samples + 1,
      v_existing_confidence,
      p_run_conf
    );
    
    -- Update existing hints
    UPDATE public.discovery_hints
    SET
      hints = v_merged_hints,
      confidence = v_new_confidence,
      samples_count = v_existing_samples + 1,
      updated_at = now()
    WHERE provider_slug = p_provider
      AND program_key = p_program
      AND form_fingerprint = p_fingerprint
      AND stage = p_stage;
  ELSE
    -- Insert new hints
    INSERT INTO public.discovery_hints (
      provider_slug,
      program_key,
      form_fingerprint,
      stage,
      hints,
      samples_count,
      confidence
    ) VALUES (
      p_provider,
      p_program,
      p_fingerprint,
      p_stage,
      v_new_hints,
      1,
      p_run_conf
    );
  END IF;
  
  RETURN v_discovery_run_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_discovery_run IS 
  'Records a discovery run, updates fingerprints, and merges hints with confidence calculation';

-- =============================================================================
-- RPC: refresh_best_hints
-- No-op function since we removed the materialized view for security
-- Kept for API compatibility but does nothing
-- Applications should query discovery_hints directly with ORDER BY
-- =============================================================================
CREATE OR REPLACE FUNCTION public.refresh_best_hints()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op: Materialized view was removed for security reasons
  -- Applications should query discovery_hints table directly
  -- with ORDER BY confidence DESC, samples_count DESC, updated_at DESC
  -- This function is kept for API compatibility
  NULL;
END;
$$;

COMMENT ON FUNCTION public.refresh_best_hints IS 
  'No-op function - materialized view removed. Query discovery_hints directly with ORDER BY for best results';