-- Add answers column to plans table for storing form responses
ALTER TABLE public.plans 
ADD COLUMN answers JSONB;

-- Add index for better performance when querying answers
CREATE INDEX idx_plans_answers ON public.plans USING GIN(answers);