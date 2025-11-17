-- Schedule daily provider feed refresh at 2:00 AM UTC
-- Calls the refresh-provider-feed edge function to update cached_provider_feed
SELECT cron.schedule(
  'daily-provider-feed-refresh',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/refresh-provider-feed',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Create a helper function to manually trigger feed refresh (useful for testing)
CREATE OR REPLACE FUNCTION public.trigger_provider_feed_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
BEGIN
  -- Call the edge function using pg_net
  SELECT * FROM net.http_post(
    url := 'https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/refresh-provider-feed',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik"}'::jsonb,
    body := '{}'::jsonb
  ) INTO v_result;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Feed refresh triggered',
    'request_id', v_result.id,
    'status', v_result.status_code
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_provider_feed_refresh() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_provider_feed_refresh() TO service_role;

COMMENT ON FUNCTION public.trigger_provider_feed_refresh() IS 
  'Manually trigger provider feed refresh via cron job. Returns request details.';
