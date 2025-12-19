-- Add audience field to cached_provider_feed for manual override
-- The system will auto-parse from title/description, but this allows manual correction

ALTER TABLE public.cached_provider_feed 
ADD COLUMN IF NOT EXISTS audience text;

-- Add comment explaining the field
COMMENT ON COLUMN public.cached_provider_feed.audience IS 'Audience type: "kids", "adults", "all", or null (auto-detect from title/description)';

-- Create index for filtering by audience
CREATE INDEX IF NOT EXISTS idx_cached_provider_feed_audience 
ON public.cached_provider_feed(audience) 
WHERE audience IS NOT NULL;