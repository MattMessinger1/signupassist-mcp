-- Create user_billing table for Stripe payment methods
CREATE TABLE public.user_billing (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  default_payment_method_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_billing ENABLE ROW LEVEL SECURITY;

-- Create policy for users to manage their own billing
CREATE POLICY "Users can manage their own billing" 
ON public.user_billing 
FOR ALL 
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_user_billing_updated_at
BEFORE UPDATE ON public.user_billing
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();