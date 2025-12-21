/**
 * PaymentStep - Step 4 of the registration form
 * Handles Stripe Checkout redirect and payment verification via MCP tools
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter,
  Button,
  Badge,
  Alert
} from '../ui';
import { useCallTool, useWidgetState } from '../../hooks/useOpenAiGlobal';
import type { OpenAIWidgetState } from '../../types/openai';

interface PaymentStepProps {
  onPaymentComplete: () => void;
  onBack: () => void;
  programName?: string;
  totalAmount?: number;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes max

export function PaymentStep({ 
  onPaymentComplete, 
  onBack,
  programName,
  totalAmount
}: PaymentStepProps) {
  const callTool = useCallTool();
  const [widgetState] = useWidgetState<OpenAIWidgetState>();
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'polling' | 'success' | 'error'>('idle');
  const [stripeOpened, setStripeOpened] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Start payment flow
  const handleSetupPayment = async () => {
    setStatus('loading');
    setErrorMessage(null);

    try {
      // Call MCP tool to create Stripe checkout session
      const result = await callTool('stripe.create_checkout_session', {
        program_ref: widgetState.selectedProgram?.program_ref,
        return_url: window.location.origin,
      });

      if (result?.url) {
        // Open Stripe Checkout in new tab (we're in an iframe)
        window.open(result.url, '_blank');
        setStripeOpened(true);
        setStatus('polling');
        startPolling();
      } else {
        throw new Error(result?.error || 'Failed to create checkout session');
      }
    } catch (error: any) {
      console.error('[PaymentStep] Error:', error);
      setErrorMessage(error?.message || 'Failed to start payment process');
      setStatus('error');
    }
  };

  // Poll for payment completion
  const startPolling = () => {
    pollCountRef.current = 0;
    
    pollIntervalRef.current = setInterval(async () => {
      pollCountRef.current++;
      
      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        clearInterval(pollIntervalRef.current!);
        setStatus('error');
        setErrorMessage('Payment verification timed out. Click "Verify Payment" if you completed payment.');
        return;
      }

      try {
        const result = await callTool('stripe.check_payment_status', {});
        
        if (result?.hasPaymentMethod) {
          clearInterval(pollIntervalRef.current!);
          setStatus('success');
          // Brief delay then proceed
          setTimeout(() => {
            onPaymentComplete();
          }, 1500);
        }
      } catch (error) {
        console.warn('[PaymentStep] Poll error:', error);
        // Continue polling even on error
      }
    }, POLL_INTERVAL_MS);
  };

  // Manual verification
  const handleVerifyPayment = async () => {
    setStatus('loading');
    
    try {
      const result = await callTool('stripe.check_payment_status', {});
      
      if (result?.hasPaymentMethod) {
        setStatus('success');
        setTimeout(() => {
          onPaymentComplete();
        }, 1500);
      } else {
        setStatus('polling');
        setErrorMessage('Payment method not yet detected. Please complete payment in the Stripe window.');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Verification failed');
      setStatus('error');
    }
  };

  // Re-open Stripe window
  const handleReopenStripe = async () => {
    setStatus('loading');
    await handleSetupPayment();
  };

  const formatMoney = (cents: number) => 
    (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Step 4 of 4
          </Badge>
        </div>
        <CardTitle>💳 Secure Payment</CardTitle>
        <CardDescription>
          Complete your registration with a secure payment via Stripe
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Payment Summary */}
        {(programName || totalAmount) && (
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">Payment Summary</h4>
            {programName && (
              <p className="text-sm text-gray-600">Program: {programName}</p>
            )}
            {totalAmount && (
              <p className="text-lg font-bold text-gray-900 mt-1">
                Total: {formatMoney(totalAmount)}
              </p>
            )}
          </div>
        )}

        {/* Status Display */}
        {status === 'polling' && (
          <Alert className="bg-blue-50 border-blue-200">
            <div className="flex items-center gap-3">
              <span className="animate-spin text-xl">⏳</span>
              <div>
                <p className="font-medium text-blue-900">Waiting for payment...</p>
                <p className="text-sm text-blue-700">
                  Complete payment in the Stripe window. This page will update automatically.
                </p>
              </div>
            </div>
          </Alert>
        )}

        {status === 'success' && (
          <Alert className="bg-green-50 border-green-200">
            <div className="flex items-center gap-3">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-medium text-green-900">Payment method verified!</p>
                <p className="text-sm text-green-700">Proceeding to confirmation...</p>
              </div>
            </div>
          </Alert>
        )}

        {status === 'error' && errorMessage && (
          <Alert variant="destructive">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="font-medium">{errorMessage}</p>
              </div>
            </div>
          </Alert>
        )}

        {/* Security Note */}
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-start gap-3">
            <span className="text-lg">🔒</span>
            <div>
              <p className="text-sm font-medium text-green-900">Secure Payment</p>
              <p className="text-xs text-green-700 mt-1">
                Payment is processed securely by Stripe. Your card information is never stored on our servers.
              </p>
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row gap-3">
        <Button 
          type="button" 
          variant="outline" 
          onClick={onBack}
          disabled={status === 'loading' || status === 'polling'}
        >
          ← Back
        </Button>

        <div className="flex-1 flex flex-col sm:flex-row gap-2 justify-end">
          {!stripeOpened && status !== 'success' && (
            <Button
              variant="accent"
              onClick={handleSetupPayment}
              disabled={status === 'loading'}
              className="min-w-[180px]"
            >
              {status === 'loading' ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Loading...
                </>
              ) : (
                '💳 Setup Payment Method'
              )}
            </Button>
          )}

          {stripeOpened && status !== 'success' && (
            <>
              <Button
                variant="outline"
                onClick={handleReopenStripe}
                disabled={status === 'loading'}
              >
                🔄 Re-open Stripe
              </Button>
              <Button
                variant="secondary"
                onClick={handleVerifyPayment}
                disabled={status === 'loading'}
              >
                ✓ Verify Payment
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
