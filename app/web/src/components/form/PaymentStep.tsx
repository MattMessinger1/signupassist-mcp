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
import { useWidgetState } from '../../hooks/useOpenAiGlobal';
import { 
  PAYMENT_CONFIG, 
  formatMoney, 
  COPY,
  type PaymentStatus 
} from '../../lib/core';
import { tools } from '../../lib/adapters/toolAdapter';
import type { OpenAIWidgetState } from '../../types/openai';

interface PaymentStepProps {
  onPaymentComplete: () => void;
  onBack: () => void;
  programName?: string;
  totalAmount?: number;
}

export function PaymentStep({ 
  onPaymentComplete, 
  onBack,
  programName,
  totalAmount
}: PaymentStepProps) {
  const [widgetState] = useWidgetState<OpenAIWidgetState>();
  
  const [status, setStatus] = useState<PaymentStatus>('idle');
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

    const result = await tools.stripe.createCheckoutSession({
      program_ref: widgetState.selectedProgram?.program_ref,
      return_url: window.location.origin,
    });

    if (result.success && result.data?.url) {
      // Open Stripe Checkout in new tab (we're in an iframe)
      window.open(result.data.url, '_blank');
      setStripeOpened(true);
      setStatus('polling');
      startPolling();
    } else {
      console.error('[PaymentStep] Error:', result.error);
      setErrorMessage(result.error || 'Failed to start payment process');
      setStatus('error');
    }
  };

  // Poll for payment completion
  const startPolling = () => {
    pollCountRef.current = 0;
    
    pollIntervalRef.current = setInterval(async () => {
      pollCountRef.current++;
      
      if (pollCountRef.current > PAYMENT_CONFIG.maxPollAttempts) {
        clearInterval(pollIntervalRef.current!);
        setStatus('timeout');
        setErrorMessage(COPY.payment.timeoutMessage);
        return;
      }

      const result = await tools.stripe.checkPaymentStatus();
      
      if (result.success && result.data?.hasPaymentMethod) {
        clearInterval(pollIntervalRef.current!);
        setStatus('success');
        // Brief delay then proceed
        setTimeout(() => {
          onPaymentComplete();
        }, PAYMENT_CONFIG.successDelayMs);
      }
    }, PAYMENT_CONFIG.pollIntervalMs);
  };

  // Manual verification
  const handleVerifyPayment = async () => {
    setStatus('loading');
    
    const result = await tools.stripe.checkPaymentStatus();
    
    if (result.success && result.data?.hasPaymentMethod) {
      setStatus('success');
      setTimeout(() => {
        onPaymentComplete();
      }, PAYMENT_CONFIG.successDelayMs);
    } else {
      setStatus('polling');
      setErrorMessage('Payment method not yet detected. Please complete payment in the Stripe window.');
    }
  };

  // Re-open Stripe window
  const handleReopenStripe = async () => {
    setStatus('loading');
    await handleSetupPayment();
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Step 4 of 4
          </Badge>
        </div>
        <CardTitle>💳 {COPY.payment.title}</CardTitle>
        <CardDescription>{COPY.payment.subtitle}</CardDescription>
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
                <p className="font-medium text-blue-900">{COPY.payment.waitingTitle}</p>
                <p className="text-sm text-blue-700">{COPY.payment.waitingSubtitle}</p>
              </div>
            </div>
          </Alert>
        )}

        {status === 'success' && (
          <Alert className="bg-green-50 border-green-200">
            <div className="flex items-center gap-3">
              <span className="text-xl">✅</span>
              <div>
                <p className="font-medium text-green-900">{COPY.payment.successTitle}</p>
                <p className="text-sm text-green-700">{COPY.payment.successSubtitle}</p>
              </div>
            </div>
          </Alert>
        )}

        {(status === 'error' || status === 'timeout') && errorMessage && (
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
              <p className="text-sm font-medium text-green-900">{COPY.payment.title}</p>
              <p className="text-xs text-green-700 mt-1">{COPY.payment.securityNote}</p>
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
