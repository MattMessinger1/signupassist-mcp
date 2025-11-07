-- Add columns to cached_programs for prerequisites, questions, and deep-links
ALTER TABLE public.cached_programs
  ADD COLUMN IF NOT EXISTS prerequisites_schema JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS questions_schema JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deep_links JSONB DEFAULT '{}'::jsonb;

-- Index for faster prerequisite lookups
CREATE INDEX IF NOT EXISTS idx_cached_programs_prereqs 
  ON public.cached_programs USING GIN (prerequisites_schema);

-- Index for questions filtering
CREATE INDEX IF NOT EXISTS idx_cached_programs_questions 
  ON public.cached_programs USING GIN (questions_schema);

-- Index for deep-links
CREATE INDEX IF NOT EXISTS idx_cached_programs_deep_links 
  ON public.cached_programs USING GIN (deep_links);

-- Add column comments for documentation
COMMENT ON COLUMN public.cached_programs.prerequisites_schema IS 
  'Cached prerequisite checks per program: membership, waiver, payment, child info';

COMMENT ON COLUMN public.cached_programs.questions_schema IS 
  'Cached program questions with field metadata: id, label, type, required, options, helper text';

COMMENT ON COLUMN public.cached_programs.deep_links IS 
  'Provider deep-link patterns: registration_start, account_creation, program_details';