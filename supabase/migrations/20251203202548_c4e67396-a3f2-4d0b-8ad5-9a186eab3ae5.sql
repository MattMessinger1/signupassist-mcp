-- Create delegate_profiles table for storing delegate information
CREATE TABLE public.delegate_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  date_of_birth DATE,
  default_relationship TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.delegate_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own delegate profile
CREATE POLICY "Users can manage their own delegate profile"
  ON public.delegate_profiles FOR ALL
  USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_delegate_profiles_updated_at
  BEFORE UPDATE ON public.delegate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();