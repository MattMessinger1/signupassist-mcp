-- ============================================
-- Add Bookeo eventId support to cached_programs
-- ============================================

-- Add earliest_slot_time (nullable)
ALTER TABLE public.cached_programs
ADD COLUMN IF NOT EXISTS earliest_slot_time timestamptz NULL;

-- Add first_available_event_id (nullable)
ALTER TABLE public.cached_programs
ADD COLUMN IF NOT EXISTS first_available_event_id text NULL;

-- Optional sanity: create an index for faster Bookeo lookups
CREATE INDEX IF NOT EXISTS idx_cached_programs_first_available_event_id
ON public.cached_programs (first_available_event_id);