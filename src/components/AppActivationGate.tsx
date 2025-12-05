import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle } from "lucide-react";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";

interface AppActivationGateProps {
  appName: string;
  appLogo?: string;
  onAllow: () => void;
  onDeny: () => void;
  isAuthenticating: boolean;
  onAuthSuccess: () => void;
}

export function AppActivationGate({
  appName,
  appLogo,
  onAllow,
  onDeny,
  isAuthenticating,
  onAuthSuccess
}: AppActivationGateProps) {
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(true);

  if (!isAuthenticating && showPermissionPrompt) {
    // Step 1: Show "Allow/Don't Allow" permission prompt (simulates ChatGPT)
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <Card className="max-w-md p-8 space-y-6 text-center shadow-lg border-2">
          {/* App Branding */}
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                {appLogo ? (
                  <img src={appLogo} alt={appName} className="w-10 h-10" />
                ) : (
                  <span className="text-3xl">🚀</span>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold">{appName}</h2>
              <Badge variant="secondary" className="mt-1">ChatGPT App</Badge>
            </div>
          </div>

          {/* Permission Request */}
          <div className="space-y-3 text-left bg-muted/50 p-4 rounded-lg">
            <p className="text-sm font-medium">This app wants to:</p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Help you sign up for programs
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Schedule auto-registrations
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                Manage your payment methods
              </li>
            </ul>
          </div>

          {/* Security Notice */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 bg-secondary/30 rounded-lg">
            <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p className="text-left">
              By allowing, you'll be asked to sign in. Your credentials are encrypted and never shared.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowPermissionPrompt(false);
                onDeny();
              }}
            >
              Don't Allow
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setShowPermissionPrompt(false);
                onAllow();
              }}
            >
              Allow
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (isAuthenticating) {
    // Step 2: Show authentication form
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <Card className="max-w-md w-full p-8 space-y-6 shadow-lg border-2">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <span className="text-2xl">🔐</span>
              </div>
            </div>
            <h2 className="text-xl font-bold">Sign in to {appName}</h2>
            <p className="text-sm text-muted-foreground">
              Create an account or sign in to continue
            </p>
          </div>

          {/* Supabase Auth UI */}
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: 'hsl(var(--primary))',
                    brandAccent: 'hsl(var(--primary))',
                  },
                },
              },
            }}
            providers={[]}
            redirectTo={window.location.origin + window.location.pathname}
          />

          {/* Back Option */}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setShowPermissionPrompt(true)}
          >
            ← Back to permissions
          </Button>
        </Card>
      </div>
    );
  }

  // Denied state
  return (
    <div className="flex items-center justify-center min-h-[500px]">
      <Card className="max-w-md p-8 space-y-6 text-center shadow-lg">
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <span className="text-3xl">🚫</span>
            </div>
          </div>
          <h2 className="text-xl font-bold">App Not Enabled</h2>
          <p className="text-sm text-muted-foreground">
            {appName} needs your permission to help with program signups.
            You can enable it anytime by refreshing the page.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowPermissionPrompt(true)}
        >
          Try Again
        </Button>
      </Card>
    </div>
  );
}
