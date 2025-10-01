-- Fix search_path for cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.browser_sessions 
  WHERE expires_at < now();
END;
$$;
