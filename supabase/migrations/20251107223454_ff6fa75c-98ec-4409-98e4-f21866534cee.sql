-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create nightly cache refresh job (runs at 2 AM UTC daily)
SELECT cron.schedule(
  'nightly-program-cache-refresh',
  '0 2 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/refresh-program-cache',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik"}'::jsonb,
        body:=concat('{"triggered_at": "', now(), '", "type": "scheduled"}')::jsonb
    ) as request_id;
  $$
);

-- Create test job that runs every minute (for immediate testing)
SELECT cron.schedule(
  'test-cache-refresh-every-minute',
  '* * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/refresh-program-cache',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik"}'::jsonb,
        body:=concat('{"triggered_at": "', now(), '", "type": "test"}')::jsonb
    ) as request_id;
  $$
);