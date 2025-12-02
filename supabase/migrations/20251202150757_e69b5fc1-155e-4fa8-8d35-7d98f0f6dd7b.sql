-- Phase A: Receipts Foundation - Create registrations table and update user_billing

-- Create registrations table for unified receipt tracking (immediate + scheduled)
CREATE TABLE public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  mandate_id UUID REFERENCES public.mandates(id),
  charge_id UUID REFERENCES public.charges(id),
  
  -- Activity details (denormalized for receipt display)
  program_name TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'bookeo',
  org_ref TEXT NOT NULL,
  start_date TIMESTAMP WITH TIME ZONE,
  
  -- Booking details  
  booking_number TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  success_fee_cents INTEGER NOT NULL DEFAULT 2000,
  
  -- Participant info
  delegate_name TEXT NOT NULL,
  delegate_email TEXT NOT NULL,
  participant_names TEXT[] NOT NULL DEFAULT '{}',
  
  -- Status workflow: pending → confirmed → completed | cancelled | failed
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Scheduling (for Set-and-Forget)
  scheduled_for TIMESTAMP WITH TIME ZONE,
  executed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- Users can view their own registrations
CREATE POLICY "Users can view their own registrations" 
ON public.registrations 
FOR SELECT 
USING (auth.uid() = user_id);

-- Service role can manage all registrations
CREATE POLICY "Service role can manage registrations" 
ON public.registrations 
FOR ALL 
USING (true);

-- Indexes for efficient queries
CREATE INDEX idx_registrations_user_status ON public.registrations(user_id, status);
CREATE INDEX idx_registrations_user_start_date ON public.registrations(user_id, start_date);
CREATE INDEX idx_registrations_scheduled_for ON public.registrations(scheduled_for) WHERE scheduled_for IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_registrations_updated_at
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add payment method display columns to user_billing
ALTER TABLE public.user_billing 
ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT,
ADD COLUMN IF NOT EXISTS payment_method_brand TEXT;