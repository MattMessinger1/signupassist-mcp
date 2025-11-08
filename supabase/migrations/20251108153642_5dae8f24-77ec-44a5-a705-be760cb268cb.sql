-- Create RPC functions for cron management
CREATE OR REPLACE FUNCTION public.query_cron_jobs(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE query INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cron_job(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE query;
END;
$$;