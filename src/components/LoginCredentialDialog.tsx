import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface LoginCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  orgName: string;
  orgRef: string;
  onSuccess?: () => void;
}

export function LoginCredentialDialog({
  open,
  onOpenChange,
  provider,
  orgName,
  orgRef,
  onSuccess
}: LoginCredentialDialogProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<{
    status?: 'requires_2fa' | 'success' | 'failure' | 'error';
    message?: string;
    browserbase_url?: string;
    credential_stored?: boolean;
  }>({});

  const handleRetry = () => {
    // Reset all state for fresh attempt
    setLoginStatus({});
    setPassword("");
    toast({
      title: "Ready to Try Again",
      description: "Enter your credentials when ready",
    });
  };

  const handleLogin = async () => {
    if (!email || !password) {
      toast({
        title: "Missing Information",
        description: "Please enter both email and password",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    // Clear any previous status before attempting login
    setLoginStatus({});

    try {
      // Step 1: Create discovery mandate via edge function
      console.log('[LoginCredentialDialog] Creating discovery mandate...');
      const { data: mandateResult, error: mandateError } = await supabase.functions.invoke('create-mandate', {
        body: {
          provider: 'skiclubpro',
          org_ref: orgRef,
          scope: ['scp:authenticate', 'scp:read:listings'],
          mandate_tier: 'discovery',
          valid_duration_minutes: 1440 // 24 hours
        }
      });

      if (mandateError) {
        console.error('[LoginCredentialDialog] Failed to create mandate:', mandateError);
        throw new Error(`Failed to create mandate: ${mandateError.message}`);
      }

      if (!mandateResult?.success || !mandateResult?.mandate_id) {
        throw new Error(mandateResult?.error || 'Failed to create mandate');
      }

      console.log('[LoginCredentialDialog] Mandate created:', mandateResult.mandate_id);

      // Step 2: Call browserbase login with mandate_id
      const { data, error } = await supabase.functions.invoke('start-browserbase-login', {
        body: {
          provider,
          org_ref: orgRef,
          email,
          password,
          mandate_id: mandateResult.mandate_id
        }
      });

      if (error) {
        throw error;
      }

      setLoginStatus(data);

      // Handle different login statuses
      if (data.status === 'requires_2fa') {
        toast({
          title: "2FA Required 🔐",
          description: data.message,
        });
        
        // If browserbase URL provided, open it
        if (data.browserbase_url) {
          window.open(data.browserbase_url, '_blank', 'noopener,noreferrer');
        }
      } else if (data.status === 'success') {
        toast({
          title: "Login Successful ✅",
          description: "Your account is connected! I'll help you browse classes next...",
        });
        
        setLoginStatus(data);
        
        // Wait a moment to show success message before closing
        setTimeout(() => {
          // Clear form
          setEmail("");
          setPassword("");
          
          // Trigger success callback before closing
          if (onSuccess) {
            onSuccess();
          }
          
          // Close dialog
          onOpenChange(false);
        }, 2000);
      } else if (data.status === 'failure') {
        // Friendly error message instead of harsh "failed"
        toast({
          title: "Hmm, that didn't go through",
          description: "Let's try again with your credentials",
          variant: "destructive",
        });
        setLoginStatus({
          ...data,
          message: "Hmm, it looks like that didn't go through. Please check your credentials and let's try again."
        });
      } else {
        toast({
          title: "Something went wrong",
          description: "Let's try that again",
          variant: "destructive",
        });
        setLoginStatus({
          ...data,
          message: "Hmm, something unexpected happened. Let's try that again."
        });
      }

    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to login";
      
      toast({
        title: "Hmm, that didn't go through",
        description: "Let's try again",
        variant: "destructive",
      });
      
      // Set status to 'error' to trigger "Try Again" button
      setLoginStatus({
        status: 'error',
        message: `Hmm, it looks like that didn't go through. ${errorMessage}. Let's try again.`
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-5 w-5 text-primary" />
            <DialogTitle>Connect to {orgName}</DialogTitle>
          </div>
          <DialogDescription>
            Enter your {orgName} credentials. Your password is encrypted and never stored in plain text.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {loginStatus.message && (
            <div className={`p-3 rounded-lg text-sm space-y-2 ${
              loginStatus.status === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200'
                : loginStatus.status === 'requires_2fa'
                ? 'bg-blue-50 text-blue-800 border border-blue-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              <p className="font-medium">{loginStatus.message}</p>
              {loginStatus.status === 'success' && (
                <>
                  {loginStatus.credential_stored && (
                    <p className="text-xs">✓ Credentials securely stored (encrypted)</p>
                  )}
                  <p className="text-xs">✓ Mandate issued and logged</p>
                  <p className="text-xs">
                    ✓ View your{' '}
                    <a 
                      href="/mandates-audit" 
                      target="_blank"
                      className="underline font-semibold hover:opacity-80"
                    >
                      authorization history
                    </a>
                  </p>
                  <p className="text-xs mt-2 italic">
                    Great, your account is connected. I'll help you browse classes next... 
                    <span className="text-green-600">(placeholder — browsing flow coming soon)</span>
                  </p>
                </>
              )}
            </div>
          )}

          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3 max-h-48 overflow-y-auto">
            <div className="flex items-start gap-2">
              <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-2 flex-1">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Discovery Authorization
                </p>
                
                <div className="space-y-2 text-xs text-blue-800 dark:text-blue-200">
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>What we're asking permission for:</strong> By clicking "Connect Account," you authorize SignupAssist to log into your {orgName} account to browse programs and check prerequisites. This is read-only access.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>What we CAN'T do with this authorization:</strong> We cannot submit registrations, process payments, or modify your account. Those actions require a separate "execution mandate" that you'll explicitly approve later.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>How it works:</strong> We create a cryptographically signed "discovery mandate" (permission token) valid for 24 hours. You can browse freely during this time.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>Security guarantees:</strong> Your credentials are encrypted end-to-end. We never store your password in plain text. The login session is isolated and automatically destroyed after use.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>Full transparency:</strong> Every action taken under this authorization is logged in your{' '}
                      <a 
                        href="/mandates-audit" 
                        target="_blank" 
                        className="underline font-semibold hover:text-blue-600 dark:hover:text-blue-300"
                      >
                        audit trail
                      </a>
                      , including when the mandate was issued, what actions were attempted, and the outcome of each action.
                    </p>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                    <p>
                      <strong>Your control:</strong> You can revoke access at any time by visiting your audit trail. All mandates have strict expiration times and cannot be extended without your explicit consent.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            disabled={isLoading}
          >
            Cancel
          </Button>
          
          {(loginStatus.status === 'failure' || loginStatus.status === 'error') ? (
            <Button
              onClick={handleRetry}
              className="flex-1"
              disabled={isLoading}
            >
              Try Again
            </Button>
          ) : (
            <Button
              onClick={handleLogin}
              className="flex-1"
              disabled={isLoading || !email || !password}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect Account'
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
