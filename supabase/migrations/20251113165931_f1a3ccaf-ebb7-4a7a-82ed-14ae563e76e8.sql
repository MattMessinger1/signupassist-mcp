-- Clean up fake/test cache data and add URL validation
-- Part 1: Delete fake test data from cached_programs

-- Delete entries with fake program names or null URLs
DELETE FROM public.cached_programs
WHERE org_ref = 'blackhawk-ski-club'
  AND cached_at < '2025-11-13'
  AND (
    -- Fake test program names
    programs_by_theme::text LIKE '%test-lesson%'
    OR programs_by_theme::text LIKE '%Beginner Ski Lessons%'
    -- Null or empty cta_href (indicating fake data)
    OR programs_by_theme::text LIKE '%"cta_href":null%'
    OR programs_by_theme::text LIKE '%"cta_href":""%'
  );

-- Part 2: Create URL validation function
CREATE OR REPLACE FUNCTION public.validate_program_url(url TEXT, org_ref TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Allow null URLs
  IF url IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- Validate blackhawk-ski-club URLs
  IF org_ref = 'blackhawk-ski-club' THEN
    -- Must use blackhawk.skiclubpro.team domain
    RETURN url LIKE 'https://blackhawk.skiclubpro.team/%';
  END IF;
  
  -- For other orgs, validate skiclubpro.team pattern
  RETURN url LIKE 'https://%.skiclubpro.team/%';
END;
$$;

-- Part 3: Create validation trigger for cached_programs
CREATE OR REPLACE FUNCTION public.validate_cached_programs_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  program_rec JSONB;
  invalid_url TEXT;
BEGIN
  -- Validate URLs in deep_links
  IF NEW.deep_links IS NOT NULL THEN
    FOR program_rec IN SELECT jsonb_array_elements(NEW.deep_links)
    LOOP
      invalid_url := program_rec->>'url';
      IF invalid_url IS NOT NULL AND NOT public.validate_program_url(invalid_url, NEW.org_ref) THEN
        RAISE EXCEPTION 'Invalid program URL detected: % for org_ref: %', invalid_url, NEW.org_ref;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS validate_cached_programs_urls_trigger ON public.cached_programs;
CREATE TRIGGER validate_cached_programs_urls_trigger
  BEFORE INSERT OR UPDATE ON public.cached_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cached_programs_urls();

-- Part 4: Add audit logging for cache operations
COMMENT ON FUNCTION public.validate_program_url(TEXT, TEXT) IS 
  'Validates that program URLs use the correct domain for each organization. 
   Prevents caching of programs with incorrect domains (e.g., blackhawkskiclub.org vs blackhawk.skiclubpro.team)';

COMMENT ON FUNCTION public.validate_cached_programs_urls() IS 
  'Trigger function that validates all program URLs before caching. 
   Prevents the 404 errors caused by incorrect domain usage.';