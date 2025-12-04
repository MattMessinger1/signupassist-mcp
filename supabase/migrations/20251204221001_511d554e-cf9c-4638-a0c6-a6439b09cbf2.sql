-- Add city and state columns to delegate_profiles for location-based provider matching
-- This enables automatic provider activation for returning authenticated users

ALTER TABLE public.delegate_profiles 
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text;