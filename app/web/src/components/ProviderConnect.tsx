/**
 * ProviderConnect Component
 * 
 * Handles secure provider account connection for the ChatGPT Apps SDK widget.
 * Uses shared core library and typed MCP tool adapter.
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/primitives';
import { tools, waitForProviderLogin } from '../lib/adapters/toolAdapter';
import { COPY } from '../lib/core/copy';

// ============ Types ============

export interface ProviderConnectProps {
  provider: string;
  orgName: string;
  orgRef: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onCreateAccount?: () => void;
}

type ConnectionStatus = 'idle' | 'checking' | 'connecting' | 'polling' | 'success' | 'error';

// ============ Security Points ============

const SECURITY_POINTS = [
  'You\'ll log in directly with the provider',
  'We never see or store your password',
  'Your credentials are encrypted and secure',
];

// ============ Icons ============

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function LoginIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

// ============ Main Component ============

export function ProviderConnect({ 
  provider, 
  orgName, 
  orgRef, 
  onSuccess, 
  onError,
  onCreateAccount 
}: ProviderConnectProps) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSecureLogin = useCallback(async () => {
    setStatus('checking');
    setErrorMessage(null);

    try {
      // First check if user already has credentials
      const credCheck = await tools.provider.checkCredentials(provider);
      
      if (credCheck.success && credCheck.data?.hasCredentials) {
        setStatus('success');
        onSuccess?.();
        return;
      }

      // Start login flow
      setStatus('connecting');
      const loginResult = await tools.provider.startLogin(provider);

      if (!loginResult.success || !loginResult.data?.session_id) {
        throw new Error(loginResult.error || 'Failed to start login');
      }

      // If there's a login URL, open it
      if (loginResult.data.login_url) {
        window.open(loginResult.data.login_url, '_blank', 'noopener,noreferrer');
      }

      // Poll for completion
      setStatus('polling');
      const pollResult = await waitForProviderLogin(loginResult.data.session_id);

      if (pollResult.success && pollResult.data?.success) {
        setStatus('success');
        onSuccess?.();
      } else {
        throw new Error(pollResult.error || 'Login verification failed');
      }
    } catch (error: any) {
      setStatus('error');
      const message = error?.message || 'Connection failed';
      setErrorMessage(message);
      onError?.(message);
    }
  }, [provider, onSuccess, onError]);

  const handleCreateAccount = useCallback(() => {
    // Construct signup URL based on provider
    let signupUrl = '';
    
    if (provider === 'skiclubpro') {
      const baseDomain = orgRef === 'blackhawk-ski-club'
        ? 'blackhawk.skiclubpro.team'
        : `${orgRef.replace(/[^a-z0-9-]/g, '').toLowerCase()}.skiclubpro.team`;
      signupUrl = `https://${baseDomain}/register`;
    } else {
      signupUrl = `https://${provider}.com/signup`;
    }

    window.open(signupUrl, '_blank', 'noopener,noreferrer');
    onCreateAccount?.();
  }, [provider, orgRef, onCreateAccount]);

  const isLoading = status === 'checking' || status === 'connecting' || status === 'polling';
  const isSuccess = status === 'success';

  return (
    <Card className="w-full max-w-md border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <ShieldIcon className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Connect {orgName}</CardTitle>
        </div>
        <CardDescription>
          {COPY.consent.providerLoginDescription || 
           `To browse classes and register, connect your ${orgName} account securely.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Security Points */}
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          {SECURITY_POINTS.map((point, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">{point}</p>
            </div>
          ))}
        </div>

        {/* Error Message */}
        {status === 'error' && errorMessage && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Success Message */}
        {isSuccess && (
          <div className="bg-primary/10 text-primary rounded-lg p-3 text-sm flex items-center gap-2">
            <CheckIcon className="h-4 w-4" />
            Account connected successfully!
          </div>
        )}

        {/* Status Messages */}
        {status === 'polling' && (
          <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
            <LoadingSpinner className="h-4 w-4" />
            Waiting for login to complete...
          </div>
        )}

        {/* Connect Button */}
        <button
          onClick={handleSecureLogin}
          disabled={isLoading || isSuccess}
          className={`w-full inline-flex items-center justify-center px-4 py-3 rounded-lg text-base font-medium transition-colors ${
            isSuccess
              ? 'bg-primary/20 text-primary cursor-default'
              : isLoading
              ? 'bg-primary/70 text-primary-foreground cursor-wait'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {isLoading ? (
            <>
              <LoadingSpinner className="mr-2 h-4 w-4" />
              {status === 'checking' && 'Checking credentials...'}
              {status === 'connecting' && 'Starting secure login...'}
              {status === 'polling' && 'Verifying connection...'}
            </>
          ) : isSuccess ? (
            <>
              <CheckIcon className="mr-2 h-4 w-4" />
              Connected
            </>
          ) : (
            <>
              <LoginIcon className="mr-2 h-4 w-4" />
              Connect {orgName} Account
            </>
          )}
        </button>

        {/* Create Account Link */}
        {!isSuccess && (
          <div className="text-center">
            <button
              onClick={handleCreateAccount}
              disabled={isLoading}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Don't have an account? Create one
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ProviderConnect;
