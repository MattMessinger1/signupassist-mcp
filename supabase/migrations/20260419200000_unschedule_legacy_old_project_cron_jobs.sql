-- Remove legacy cron jobs that were created by older migrations with
-- hardcoded Supabase project URLs/tokens. Production scheduling should be
-- recreated through current env-aware worker/cron configuration.

DO $$
DECLARE
  job_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_namespace
    WHERE nspname = 'cron'
  ) THEN
    RETURN;
  END IF;

  FOREACH job_name IN ARRAY ARRAY[
    'test-cache-refresh-every-minute',
    'blackhawk-program-feed-refresh'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = job_name
    ) THEN
      EXECUTE 'SELECT cron.unschedule($1)' USING job_name;
    END IF;
  END LOOP;
END $$;
