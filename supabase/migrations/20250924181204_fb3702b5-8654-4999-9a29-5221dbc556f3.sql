-- Enable pg_cron extension for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create cron job to run plan-scheduler every minute
SELECT cron.schedule(
  'run-plan-scheduler',
  '* * * * *', -- every minute
  $$
  SELECT
    net.http_post(
        url:='https://jpcrphdevmvzcfgokgym.supabase.co/functions/v1/plan-scheduler',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwY3JwaGRldm12emNmZ29rZ3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODU3ODIsImV4cCI6MjA3NDE2MTc4Mn0.LBcuw6dTJfF7QIfxyvV2s8LRCNKHxO3PvQSw6VrAaik"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);