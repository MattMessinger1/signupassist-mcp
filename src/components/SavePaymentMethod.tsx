/**
 * SavePaymentMethod - Stripe Checkout Redirect (Same-Window)
 * 
 * ChatGPT App Store Compliant: No in-app card input (PCI violation).
 * Redirects users to Stripe's hosted checkout page for payment method setup.
 * Uses same-window redirect with sessionStorage state persistence.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, CreditCard, Loader2, ExternalLink } from 'lucide-react';

// Storage key for persisting chat state before Stripe redirect
const STRIPE_RETURN_STATE_KEY = 'signupassist_stripe_return_state';

interface SavePaymentMethodProps {
  onPaymentMethodSaved?: () => void;
  hasPaymentMethod?: boolean;
  mockUserId?: string;
  mockUserEmail?: string;
}

// Helper to persist state before redirect
export function persistStateBeforeStripeRedirect(state: {
  sessionId: string;
  messages: any[];
  formData: any;
  pendingPaymentMetadata: any;
}) {
  sessionStorage.setItem(STRIPE_RETURN_STATE_KEY, JSON.stringify({
    ...state,
    timestamp: Date.now()
  }));
  console.log('[SavePaymentMethod] Persisted state before Stripe redirect');
}

// Helper to retrieve and clear state after return
export function getAndClearStripeReturnState(): {
  sessionId: string;
  messages: any[];
  formData: any;
  pendingPaymentMetadata: any;
  timestamp: number;
} | null {
  const stored = sessionStorage.getItem(STRIPE_RETURN_STATE_KEY);
  if (stored) {
    sessionStorage.removeItem(STRIPE_RETURN_STATE_KEY);
    try {
      const parsed = JSON.parse(stored);
      // Only use state if less than 30 minutes old
      if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
        console.log('[SavePaymentMethod] Retrieved persisted state after Stripe return');
        return parsed;
      }
    } catch (e) {
      console.error('[SavePaymentMethod] Failed to parse persisted state:', e);
    }
  }
  return null;
}

// Helper to detect if running inside an iframe (Lovable preview)
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true; // If we can't access window.top, we're in a sandboxed iframe
  }
}

export const SavePaymentMethod: React.FC<SavePaymentMethodProps> = ({
  onPaymentMethodSaved,
  hasPaymentMethod = false,
  mockUserId,
  mockUserEmail,
}) => {
  console.log('[SavePaymentMethod] 🚀 COMPONENT RENDER STARTED', { hasPaymentMethod, timestamp: new Date().toISOString() });

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [stripeUrl, setStripeUrl] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const { toast } = useToast();

  // Auto-polling for payment completion (when Stripe opens in new tab)
  useEffect(() => {
    if (!showFallback || hasPaymentMethod) {
      return; // Only poll when in fallback mode and no payment method yet
    }

    console.log('[SavePaymentMethod] 🔄 Starting auto-poll for payment completion');
    setIsPolling(true);
    
    const POLL_INTERVAL = 3000; // 3 seconds
    const MAX_POLL_TIME = 5 * 60 * 1000; // 5 minutes timeout
    const startTime = Date.now();

    const pollForPayment = async () => {
      try {
        let userId = mockUserId;
        if (!userId) {
          const { data: { user } } = await supabase.auth.getUser();
          userId = user?.id;
        }

        if (!userId) {
          console.log('[SavePaymentMethod] No user ID for polling');
          return false;
        }

        const { data: billing } = await supabase
          .from('user_billing')
          .select('default_payment_method_id, payment_method_brand, payment_method_last4')
          .eq('user_id', userId)
          .maybeSingle();

        if (billing?.default_payment_method_id) {
          console.log('[SavePaymentMethod] ✅ Auto-detected payment method!', billing);
          toast({
            title: 'Payment Method Saved!',
            description: `Your ${billing.payment_method_brand} •••• ${billing.payment_method_last4} is ready.`,
          });
          setIsPolling(false);
          onPaymentMethodSaved?.();
          return true; // Payment found
        }
        
        return false; // Keep polling
      } catch (error) {
        console.error('[SavePaymentMethod] Polling error:', error);
        return false;
      }
    };

    const intervalId = setInterval(async () => {
      // Check timeout
      if (Date.now() - startTime > MAX_POLL_TIME) {
        console.log('[SavePaymentMethod] Polling timeout reached');
        setIsPolling(false);
        clearInterval(intervalId);
        return;
      }

      const found = await pollForPayment();
      if (found) {
        clearInterval(intervalId);
      }
    }, POLL_INTERVAL);

    // Initial check immediately
    pollForPayment();

    return () => {
      console.log('[SavePaymentMethod] Cleaning up polling');
      setIsPolling(false);
      clearInterval(intervalId);
    };
  }, [showFallback, hasPaymentMethod, mockUserId, onPaymentMethodSaved, toast]);

  // Auto-detect return from Stripe on mount (URL params)
  useEffect(() => {
    const checkStripeReturn = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const paymentSetup = urlParams.get('payment_setup');
      const sessionId = urlParams.get('session_id');
      
      if (paymentSetup === 'success' && sessionId) {
        console.log('[SavePaymentMethod] Detected return from Stripe checkout:', sessionId);
        setVerifying(true);
        
        try {
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
          
          // Trigger callback
          onPaymentMethodSaved?.();
        } catch (error) {
          console.error('[SavePaymentMethod] ❌ Verification error:', error);
          toast({
            title: 'Verification Issue',
            description: 'Please click "Verify Payment Method" to complete setup.',
            variant: 'destructive',
          });
        } finally {
          setVerifying(false);
        }
      } else if (paymentSetup === 'canceled') {
        console.log('[SavePaymentMethod] User canceled Stripe checkout');
        toast({
          title: 'Payment Setup Canceled',
          description: 'You can try again when ready.',
        });
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      }
    };
    
    checkStripeReturn();
  }, [onPaymentMethodSaved, toast]);

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

      // Get current URL for redirect (same window)
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

      // Store URL for fallback display
      setStripeUrl(data.url);

      // Persist MCPChat state before redirect (if available)
      if (typeof (window as any).__persistMCPChatState === 'function') {
        (window as any).__persistMCPChatState();
        console.log('[SavePaymentMethod] Called state persistence before redirect');
      }

      // Check if we're in an iframe (Lovable preview)
      if (isInIframe()) {
        console.log('[SavePaymentMethod] Detected iframe environment - opening Stripe in new tab');
        // In iframe: open in new tab (iframe blocks same-window redirects to external URLs)
        window.open(data.url, '_blank');
        setLoading(false);
        setShowFallback(true); // Show verification button immediately
        toast({
          title: "Stripe Opened",
          description: "Complete payment setup in the new tab, then click 'Verify Payment Method'.",
        });
      } else {
        // Production/deployed: same-window redirect for better UX
        console.log('[SavePaymentMethod] Production environment - same-window redirect');
        window.location.assign(data.url);
        
        // Show fallback link after 3 seconds if still on page
        setTimeout(() => {
          console.log('[SavePaymentMethod] Showing fallback link');
          setShowFallback(true);
        }, 3000);
      }

    } catch (error) {
      console.error('[SavePaymentMethod] ❌ Error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start payment setup',
        variant: 'destructive',
      });
      setLoading(false);
    }
  }, [toast, mockUserId, mockUserEmail]);

  // Handle manual verification (fallback)
  const handleVerifyPayment = useCallback(async () => {
    setLoading(true);
    
    try {
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
            description: 'Please complete payment setup first.',
            variant: 'destructive',
          });
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

  if (verifying) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Verifying Payment Method...
          </CardTitle>
          <CardDescription>Please wait while we confirm your payment setup.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

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
          {showFallback 
            ? "Complete payment setup in the Stripe tab, then verify below."
            : "You'll be redirected to Stripe's secure page to add your card."
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Primary: Set Up Payment - hide when fallback is showing */}
          {!showFallback && (
            <Button 
              onClick={handleSetupPayment} 
              disabled={loading} 
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening Stripe...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Set Up Payment Method
                </>
              )}
            </Button>
          )}
          
          {/* After Stripe opened: show verify + retry options */}
          {showFallback && (
            <>
              {/* Auto-polling status banner */}
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-center">
                {isPolling ? (
                  <>
                    <p className="text-sm font-medium text-primary flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Waiting for payment completion...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Complete setup in the Stripe tab — we'll detect it automatically
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-primary">
                      ✅ Complete payment in the Stripe tab
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Or click "Verify" below when done
                    </p>
                  </>
                )}
              </div>
              
              <Button
                onClick={handleVerifyPayment} 
                disabled={loading} 
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    I've Added My Card - Verify
                  </>
                )}
              </Button>
              
              {stripeUrl && (
                <a 
                  href={stripeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full"
                >
                  <Button variant="outline" className="w-full">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Re-open Stripe
                  </Button>
                </a>
              )}
              
              <Button 
                variant="ghost"
                onClick={() => setShowFallback(false)} 
                className="w-full text-muted-foreground"
              >
                Start Over
              </Button>
            </>
          )}
          
          <p className="text-xs text-muted-foreground text-center">
            Secure payment powered by Stripe. Your card details are never stored on our servers.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
