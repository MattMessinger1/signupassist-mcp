/**
 * Stripe Checkout Redirect Component
 * 
 * ChatGPT App Store Compliant: No in-app card input (PCI violation).
 * Redirects to Stripe's hosted checkout page for payment method setup.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface StripeCheckoutRedirectProps {
  onPaymentMethodSaved?: () => void;
  hasPaymentMethod?: boolean;
  userId?: string;
  userEmail?: string;
}

export const StripeCheckoutRedirect: React.FC<StripeCheckoutRedirectProps> = ({
  onPaymentMethodSaved,
  hasPaymentMethod = false,
  userId,
  userEmail,
}) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSetupPayment = async () => {
    setLoading(true);
    
    try {
      // Get current URL for redirect
      const currentUrl = window.location.href.split('?')[0];
      const successUrl = `${currentUrl}?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${currentUrl}?payment_setup=canceled`;

      const { data, error } = await supabase.functions.invoke('stripe-checkout-setup', {
        body: {
          success_url: successUrl,
          cancel_url: cancelUrl,
          user_id: userId,
          user_email: userEmail
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.url) {
        throw new Error('No checkout URL returned');
      }

      // Open Stripe Checkout in new tab (recommended for ChatGPT apps)
      window.open(data.url, '_blank');
      
      toast({
        title: 'Redirecting to Stripe',
        description: 'Complete your payment setup in the new tab, then return here.',
      });

      // Optionally notify parent that redirect occurred
      // User will need to manually confirm when they return

    } catch (error) {
      console.error('[StripeCheckoutRedirect] Error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start payment setup',
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
        <CardDescription>
          You'll be redirected to Stripe's secure page to add your payment method.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button 
          onClick={handleSetupPayment} 
          disabled={loading} 
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Preparing...
            </>
          ) : (
            <>
              <ExternalLink className="mr-2 h-4 w-4" />
              Set Up Payment Method
            </>
          )}
        </Button>
        <p className="text-xs text-muted-foreground mt-3 text-center">
          Secure payment powered by Stripe. Your card details are never stored on our servers.
        </p>
      </CardContent>
    </Card>
  );
};
