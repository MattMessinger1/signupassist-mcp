import React, { useState, useCallback } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';

interface SavePaymentMethodProps {
  onPaymentMethodSaved?: () => void;
  hasPaymentMethod?: boolean;
  mockUserId?: string;
  mockUserEmail?: string;
}

export const SavePaymentMethod: React.FC<SavePaymentMethodProps> = ({
  onPaymentMethodSaved,
  hasPaymentMethod = false,
  mockUserId,
  mockUserEmail,
}) => {
  console.log('[SavePaymentMethod] 🚀 COMPONENT RENDER STARTED', { hasPaymentMethod, timestamp: new Date().toISOString() });

  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  console.log('[SavePaymentMethod] 🔌 Stripe Context:', {
    stripe: stripe ? 'LOADED' : 'MISSING',
    elements: elements ? 'LOADED' : 'MISSING',
    stripeType: typeof stripe,
    elementsType: typeof elements,
    functionsUrl: (supabase as any)?.functions?.url ?? 'UNKNOWN',
  });

  const handleSaveClick = useCallback(
    async () => {
      console.log('[SavePaymentMethod] 🖱️ SAVE CLICKED', {
        timestamp: new Date().toISOString(),
        hasStripe: !!stripe,
        hasElements: !!elements,
      });

      if (!stripe || !elements) {
        console.error('[SavePaymentMethod] ❌ Stripe not ready');
        toast({
          title: 'Error',
          description: 'Stripe has not loaded yet. Please try again.',
          variant: 'destructive',
        });
        return;
      }

      setLoading(true);
      console.log('[SavePaymentMethod] Starting payment method save process');

      try {
        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          throw new Error('Card element not found');
        }

        console.log('[SavePaymentMethod] Creating payment method...');
        const { error: createError, paymentMethod } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElement,
        });

        if (createError) {
          throw new Error(createError.message);
        }
        if (!paymentMethod) {
          throw new Error('Failed to create payment method');
        }

        console.log('[SavePaymentMethod] ✅ Payment method created:', paymentMethod.id);

        // Use mock user if provided, otherwise get authenticated user
        let userId: string;
        let userEmail: string;
        
        if (mockUserId && mockUserEmail) {
          userId = mockUserId;
          userEmail = mockUserEmail;
          console.log('[SavePaymentMethod] Using mock user:', userId);
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          
          if (!user) {
            throw new Error('User not authenticated');
          }
          
          userId = user.id;
          userEmail = user.email!;
          console.log('[SavePaymentMethod] User authenticated:', userId);
        }

        // Get/create customer
        const { data: billingData } = await supabase
          .from('user_billing')
          .select('stripe_customer_id')
          .eq('user_id', userId)
          .maybeSingle();

        let customerId = billingData?.stripe_customer_id;

        if (!customerId) {
          console.log('[SavePaymentMethod] Creating new Stripe customer...');
          const { data: customerData, error: customerError } = await supabase.functions.invoke('create-stripe-customer');
          
          if (customerError) {
            throw new Error(`Failed to create customer: ${customerError.message}`);
          }
          
          customerId = customerData?.customer_id;
          
          if (!customerId) {
            throw new Error('Customer creation returned no ID');
          }
          
          console.log('[SavePaymentMethod] ✅ Stripe customer created:', customerId);
        } else {
          console.log('[SavePaymentMethod] Using existing customer ID:', customerId);
        }

        // Save payment method via Edge Function
        console.log('[SavePaymentMethod] 📡 Invoking save-payment-method Edge Function...', {
          url: (supabase as any)?.functions?.url,
          user_id: userId,
          payment_method_id: paymentMethod.id,
          customer_id: customerId,
        });

        const { data: saveData, error: saveError } = await supabase.functions.invoke('save-payment-method', {
          body: {
            payment_method_id: paymentMethod.id,
            customer_id: customerId,
          },
        });

        console.log('[SavePaymentMethod] 📡 Edge Function response:', { saveData, saveError });

        if (saveError) {
          throw new Error(saveError.message);
        }
        
        if (saveData?.error) {
          throw new Error(saveData.error);
        }

        console.log('[SavePaymentMethod] ✅ Payment method saved successfully');

        toast({ 
          title: 'Success', 
          description: 'Payment method saved successfully!' 
        });

        cardElement.clear();
        console.log('[SavePaymentMethod] Card element cleared');

        // Update billing table with payment method ID
        const { error: updateError } = await supabase
          .from('user_billing')
          .update({ default_payment_method_id: paymentMethod.id })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[SavePaymentMethod] Failed to update billing table:', updateError);
        } else {
          console.log('[SavePaymentMethod] ✅ Payment method ID stored in user_billing');
        }

        // Inform parent
        console.log('[SavePaymentMethod] Calling onPaymentMethodSaved callback');
        onPaymentMethodSaved?.();
        console.log('[SavePaymentMethod] Callback completed');

      } catch (error) {
        console.error('[SavePaymentMethod] ❌ Error saving payment method:', error);
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to save payment method',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [stripe, elements, toast, onPaymentMethodSaved]
  );

  if (hasPaymentMethod) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Payment Method Configured
          </CardTitle>
          <CardDescription>Your default payment method is ready.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Add Payment Method
        </CardTitle>
        <CardDescription>Add a card to enable billing for automated registration.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-4 border rounded-md">
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#424770',
                    '::placeholder': { color: '#aab7c4' },
                  },
                },
              }}
            />
          </div>
          <Button 
            type="button" 
            onClick={handleSaveClick} 
            disabled={!stripe || loading} 
            className="w-full"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Payment Method
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};