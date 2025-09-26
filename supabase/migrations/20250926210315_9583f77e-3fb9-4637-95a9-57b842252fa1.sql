-- Create a function to automatically create Stripe customers for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_stripe_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Create an entry in user_billing table for the new user
  -- The actual Stripe customer creation will be handled by the edge function
  INSERT INTO public.user_billing (user_id, created_at, updated_at)
  VALUES (NEW.id, now(), now())
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger to run the function when a new user is created
CREATE TRIGGER on_auth_user_created_stripe
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_stripe_customer();