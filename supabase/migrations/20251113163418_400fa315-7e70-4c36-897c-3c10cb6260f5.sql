-- Unschedule the run-plan-scheduler CRON job
-- This stops it from running but keeps the edge function intact
-- Can be re-enabled later if needed
SELECT cron.unschedule('run-plan-scheduler');