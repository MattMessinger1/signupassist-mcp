/**
 * AuthCheck - Authentication gate component
 * Verifies user is authenticated, provides OTP flow if not
 */

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter,
  Button,
  Input,
  Label,
  Alert
} from './ui';
import { useCallTool, useWidgetState } from '../hooks/useOpenAiGlobal';
import type { OpenAIWidgetState } from '../types/openai';

interface AuthCheckProps {
  onAuthenticated: () => void;
  onSkip?: () => void;
}

type AuthStep = 'checking' | 'email_input' | 'otp_input' | 'authenticated' | 'error';

export function AuthCheck({ onAuthenticated, onSkip }: AuthCheckProps) {
  const callTool = useCallTool();
  const [, setWidgetState] = useWidgetState<OpenAIWidgetState>();
  
  const [step, setStep] = useState<AuthStep>('checking');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    setStep('checking');
    setErrorMessage(null);

    try {
      const result = await callTool('user.check_auth', {});
      
      if (result?.authenticated) {
        setStep('authenticated');
        // Store user info in widget state
        setWidgetState({
          guardianData: {
            delegate_email: result.email,
            delegate_firstName: result.firstName,
            delegate_lastName: result.lastName,
          }
        });
        setTimeout(() => onAuthenticated(), 500);
      } else {
        setStep('email_input');
      }
    } catch (error: any) {
      console.warn('[AuthCheck] Auth check failed:', error);
      // Default to email input on error
      setStep('email_input');
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await callTool('auth.send_otp', { email: email.trim() });
      
      if (result?.success) {
        setStep('otp_input');
      } else {
        throw new Error(result?.error || 'Failed to send verification code');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!otpCode.trim() || otpCode.length < 6) {
      setErrorMessage('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await callTool('auth.verify_otp', { 
        email: email.trim(), 
        code: otpCode.trim() 
      });
      
      if (result?.success) {
        setStep('authenticated');
        setWidgetState({
          guardianData: {
            delegate_email: email,
            ...result.user,
          }
        });
        setTimeout(() => onAuthenticated(), 500);
      } else {
        throw new Error(result?.error || 'Invalid verification code');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await callTool('auth.send_otp', { email: email.trim() });
      setErrorMessage('A new code has been sent to your email');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to resend code');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (step === 'checking') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="p-8 text-center">
          <div className="animate-spin text-3xl mb-4">⏳</div>
          <p className="text-gray-600">Checking authentication...</p>
        </CardContent>
      </Card>
    );
  }

  // Authenticated state
  if (step === 'authenticated') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-lg font-semibold text-gray-900">You're signed in!</h3>
          <p className="text-gray-600 mt-1">Proceeding to registration...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>
          {step === 'email_input' ? '👋 Welcome' : '🔐 Verify Your Email'}
        </CardTitle>
        <CardDescription>
          {step === 'email_input' 
            ? 'Enter your email to get started'
            : `We sent a 6-digit code to ${email}`
          }
        </CardDescription>
      </CardHeader>

      <CardContent>
        {errorMessage && (
          <Alert variant={errorMessage.includes('sent') ? 'default' : 'destructive'} className="mb-4">
            {errorMessage}
          </Alert>
        )}

        {step === 'email_input' && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
            >
              {isLoading ? '⏳ Sending...' : '→ Continue'}
            </Button>
          </form>
        )}

        {step === 'otp_input' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification Code</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-2xl tracking-widest font-mono"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                required
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading || otpCode.length < 6}
            >
              {isLoading ? '⏳ Verifying...' : '✓ Verify'}
            </Button>
            
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep('email_input');
                  setOtpCode('');
                  setErrorMessage(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ← Change email
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                disabled={isLoading}
                className="text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                Resend code
              </button>
            </div>
          </form>
        )}
      </CardContent>

      {onSkip && step === 'email_input' && (
        <CardFooter className="flex justify-center border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Continue as guest →
          </button>
        </CardFooter>
      )}
    </Card>
  );
}
