-- Create table for storing encrypted credentials
CREATE TABLE public.stored_credentials (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    alias TEXT NOT NULL,
    provider TEXT NOT NULL,
    user_id UUID NOT NULL,
    encrypted_data TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    
    -- Ensure one alias per provider per user
    UNIQUE(alias, provider, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.stored_credentials ENABLE ROW LEVEL SECURITY;

-- Create policies for credential access
CREATE POLICY "Users can manage their own credentials" 
ON public.stored_credentials 
FOR ALL 
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_stored_credentials_updated_at
BEFORE UPDATE ON public.stored_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();