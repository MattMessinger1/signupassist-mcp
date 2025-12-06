/**
 * SavePaymentMethod - Stripe Checkout Redirect
 * 
 * ChatGPT App Store Compliant: No in-app card input (PCI violation).
 * Redirects users to Stripe's hosted checkout page for payment method setup.
 * 
 * This is a drop-in replacement for the old CardElement-based implementation.
 */

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';

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

  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSetupPayment = useCallback(async () => {
    console.log('[SavePaymentMethod] 🖱️ SETUP CLICKED', { timestamp: new Date().toISOString() });
    setLoading(true);

    try {
      // Determine user credentials
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

      // Get current URL for redirect
      const currentUrl = window.location.href.split('?')[0];
      const successUrl = `${currentUrl}?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${currentUrl}?payment_setup=canceled`;

      console.log('[SavePaymentMethod] Creating Stripe Checkout session...');
      
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

      console.log('[SavePaymentMethod] ✅ Checkout session created:', data.session_id);

      // Open Stripe Checkout in new tab
      window.open(data.url, '_blank');

      toast({
        title: 'Redirecting to Stripe',
        description: 'Complete your payment setup in the new tab, then click "I\'ve Added My Card" below.',
      });

      // Don't auto-call onPaymentMethodSaved - user needs to confirm

    } catch (error) {
      console.error('[SavePaymentMethod] ❌ Error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start payment setup',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, mockUserId, mockUserEmail]);

  // Handle manual confirmation after Stripe redirect
  const handleConfirmPaymentSetup = useCallback(async () => {
    setLoading(true);
    
    try {
      // Check URL for session_id
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session_id');
      
      if (sessionId) {
        // Verify with Stripe and update billing
        const { data, error } = await supabase.functions.invoke('stripe-checkout-success', {
          body: { session_id: sessionId }
        });
        
        if (error) {
          throw new Error(error.message);
        }
        
        console.log('[SavePaymentMethod] ✅ Payment method verified:', data);
        
        toast({
          title: 'Payment Method Saved!',
          description: `Your ${data.brand} •••• ${data.last4} is ready.`,
        });
        
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
        
        onPaymentMethodSaved?.();
      } else {
        // No session_id in URL - user manually clicked confirm
        // Check if billing was updated
        let userId = mockUserId;
        if (!userId) {
          const { data: { user } } = await supabase.auth.getUser();
          userId = user?.id;
        }
        
        if (userId) {
          const { data: billing } = await supabase
            .from('user_billing')
            .select('default_payment_method_id, payment_method_brand, payment_method_last4')
            .eq('user_id', userId)
            .maybeSingle();
          
          if (billing?.default_payment_method_id) {
            toast({
              title: 'Payment Method Confirmed!',
              description: `Your ${billing.payment_method_brand} •••• ${billing.payment_method_last4} is ready.`,
            });
            onPaymentMethodSaved?.();
          } else {
            toast({
              title: 'No Payment Method Found',
              description: 'Please complete payment setup in the Stripe tab first.',
              variant: 'destructive',
            });
          }
        }
      }
    } catch (error) {
      console.error('[SavePaymentMethod] ❌ Verification error:', error);
      toast({
        title: 'Verification Failed',
        description: 'Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [mockUserId, onPaymentMethodSaved, toast]);

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
          You'll be redirected to Stripe's secure page to add your card.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
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
          
          <Button 
            variant="outline"
            onClick={handleConfirmPaymentSetup} 
            disabled={loading} 
            className="w-full"
          >
            I've Added My Card
          </Button>
          
          <p className="text-xs text-muted-foreground text-center">
            Secure payment powered by Stripe. Your card details are never stored on our servers.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
