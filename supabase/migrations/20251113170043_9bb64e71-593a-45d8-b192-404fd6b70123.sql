-- Fix search_path security warning for URL validation functions

-- Update validate_program_url to set search_path
CREATE OR REPLACE FUNCTION public.validate_program_url(url TEXT, org_ref TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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

-- Update validate_cached_programs_urls to set search_path
CREATE OR REPLACE FUNCTION public.validate_cached_programs_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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