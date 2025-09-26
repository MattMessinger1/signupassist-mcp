import React, { useState, useEffect } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, CheckCircle } from 'lucide-react';

interface PaymentMethodSetupProps {
  onPaymentMethodSaved: () => void;
  hasPaymentMethod: boolean;
}

export function PaymentMethodSetup({ onPaymentMethodSaved, hasPaymentMethod }: PaymentMethodSetupProps) {
  const [loading, setLoading] = useState(false);
  const [setupIntentSecret, setSetupIntentSecret] = useState('');
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();

  useEffect(() => {
    if (!hasPaymentMethod) {
      createSetupIntent();
    }
  }, [hasPaymentMethod]);

  const createSetupIntent = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-setup-intent');
      
      if (error) throw error;
      
      setSetupIntentSecret(data.client_secret);
    } catch (error) {
      console.error('Error creating setup intent:', error);
      toast({
        title: 'Error',
        description: 'Failed to initialize payment setup.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async () => {
    
    if (!stripe || !elements) return;
    
    setLoading(true);
    
    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { setupIntent, error } = await stripe.confirmCardSetup(setupIntentSecret, {
        payment_method: {
          card: cardElement,
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (setupIntent.status === 'succeeded') {
        // Update user billing with the payment method
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        const { error: updateError } = await supabase
          .from('user_billing')
          .update({
            default_payment_method_id: typeof setupIntent.payment_method === 'string' 
              ? setupIntent.payment_method 
              : setupIntent.payment_method?.id
          })
          .eq('user_id', user.id);

        if (updateError) throw updateError;

        toast({
          title: 'Success',
          description: 'Payment method saved successfully!',
        });

        onPaymentMethodSaved();
      }
    } catch (error: any) {
      console.error('Error saving payment method:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save payment method.',
        variant: 'destructive',
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
            Your payment method is set up and ready for success fees
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            ✅ Payment method on file for $20 success fee
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Save Payment Method
        </CardTitle>
        <CardDescription>
          Add a payment method for the $20 success fee (charged only when registration succeeds)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-3 border rounded-md">
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
            type="button" 
            onClick={handleSubmit}
            disabled={!stripe || loading}
            className="w-full"
          >
            {loading ? 'Saving...' : 'Save Payment Method'}
          </Button>
          
          <div className="text-xs text-muted-foreground">
            Your payment method will be securely saved with Stripe. You will only be charged $20 when we successfully register your child for a program.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}