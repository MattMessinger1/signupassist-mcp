import React, { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';

interface SavePaymentMethodProps {
  onPaymentMethodSaved?: () => void;
  hasPaymentMethod?: boolean;
}

export const SavePaymentMethod: React.FC<SavePaymentMethodProps> = ({
  onPaymentMethodSaved,
  hasPaymentMethod = false
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      toast({
        title: "Error",
        description: "Stripe has not loaded yet. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Get the authenticated user
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error("User not authenticated");
      }

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error("Card element not found");
      }

      // Create payment method
      const { error: createError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (createError) {
        throw new Error(createError.message);
      }

      if (!paymentMethod) {
        throw new Error("Failed to create payment method");
      }

      console.log('Payment method created:', paymentMethod.id);

      // Get or create Stripe customer
      const { data: billingData, error: billingError } = await supabase
        .from('user_billing')
        .select('stripe_customer_id')
        .eq('user_id', userData.user.id)
        .single();

      let customerId = billingData?.stripe_customer_id;

      // If no customer exists, create one via our new edge function
      if (!customerId) {
        console.log('No customer found, creating one...');
        const { data: customerData, error: customerError } = await supabase.functions.invoke('create-stripe-customer');
        
        if (customerError) {
          throw new Error(`Failed to create customer: ${customerError.message}`);
        }
        
        customerId = customerData?.customer_id;
        if (!customerId) {
          throw new Error("Failed to get customer ID from customer creation");
        }
      }

      console.log('Using customer ID:', customerId);

      // Save payment method via our edge function
      const { data: saveData, error: saveError } = await supabase.functions.invoke('save-payment-method', {
        body: {
          payment_method_id: paymentMethod.id,
          customer_id: customerId,
        },
      });

      if (saveError) {
        throw new Error(`Failed to save payment method: ${saveError.message}`);
      }

      if (saveData?.error) {
        throw new Error(saveData.error);
      }

      console.log('Payment method saved successfully');

      toast({
        title: "Success",
        description: "Payment method saved successfully!",
      });

      // Clear the card element
      cardElement.clear();

      // Call the callback if provided
      onPaymentMethodSaved?.();

    } catch (error) {
      console.error('Error saving payment method:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save payment method",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (hasPaymentMethod) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Payment Method Configured
          </CardTitle>
          <CardDescription>
            Your default payment method is set up and ready to use.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Add Payment Method
        </CardTitle>
        <CardDescription>
          Add a payment method to enable plan execution billing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-4 border rounded-md">
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#424770',
                    '::placeholder': {
                      color: '#aab7c4',
                    },
                  },
                },
              }}
            />
          </div>
          
          <Button 
            type="submit" 
            disabled={!stripe || loading}
            className="w-full"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Payment Method
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};