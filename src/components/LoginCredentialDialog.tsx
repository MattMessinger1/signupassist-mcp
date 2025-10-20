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
    setLoginStatus({});

    try {
      const { data, error } = await supabase.functions.invoke('start-browserbase-login', {
        body: {
          provider,
          org_ref: orgRef,
          email,
          password
        }
      });

      if (error) {
        throw error;
      }

      setLoginStatus(data);

      // Handle different login statuses
      if (data.status === 'requires_2fa') {
        toast({
          title: "2FA Required",
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
        toast({
          title: "Login Failed",
          description: data.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: data.message || "An unexpected error occurred",
          variant: "destructive",
        });
      }

    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: "Login Error",
        description: error instanceof Error ? error.message : "Failed to login",
        variant: "destructive",
      });
      setLoginStatus({
        status: 'error',
        message: error instanceof Error ? error.message : "Failed to login"
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
                    <p className="text-xs">✓ Credentials securely stored</p>
                  )}
                  <p className="text-xs">✓ Authorization logged for audit trail</p>
                  <p className="text-xs mt-2 italic">
                    Great, your account is connected. I'll help you browse classes next... 
                    <span className="text-green-600">(placeholder — browsing flow coming soon)</span>
                  </p>
                </>
              )}
            </div>
          )}

          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <div className="h-1 w-1 rounded-full bg-primary mt-1.5" />
              Your credentials are encrypted before storage
            </p>
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <div className="h-1 w-1 rounded-full bg-primary mt-1.5" />
              We verify your login securely through {orgName}
            </p>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
