-- Disable cron jobs that are creating Browserbase sessions
-- These jobs run daily at 2:00 AM and trigger automated program scraping
-- which creates Browserbase sessions continuously

-- Unschedule daily provider feed refresh
SELECT cron.unschedule('daily-provider-feed-refresh');

-- Unschedule nightly program cache refresh
SELECT cron.unschedule('nightly-program-cache-refresh');