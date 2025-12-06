import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, LogIn } from "lucide-react";
import { useState } from "react";
import { OAuthConnectDialog } from "./OAuthConnectDialog";

interface LoginPromptCardProps {
  provider: string;
  orgName: string;
  orgRef: string;
  onConnect: () => void;
}

/**
 * LoginPromptCard - Chat-native login card following LCP-P1 specification
 * Implements the Assistant → Card → CTA pattern for secure credential submission
 * 
 * Design DNA Compliance:
 * - Friendly, reassuring tone
 * - Clear security messaging
 * - Single primary CTA (Connect Account)
 * - Follows Design DNA visual rhythm
 */
export function LoginPromptCard({ provider, orgName, orgRef, onConnect }: LoginPromptCardProps) {
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const handleConnect = () => {
    // Log user consent for audit trail (responsible delegation)
    console.log(`[Audit] User initiated login for ${provider} (org: ${orgRef})`);
    setShowLoginDialog(true);
  };

  const handleLoginSuccess = () => {
    onConnect();
  };

  return (
    <Card className="w-full max-w-md border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Connect {orgName}</CardTitle>
        </div>
        <CardDescription>
          Ready to log in? You'll authenticate directly on {orgName}'s site.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-sm text-muted-foreground">
              You'll log in directly with {orgName}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-sm text-muted-foreground">
              We never see or store your password
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-sm text-muted-foreground">
              Your credentials are encrypted and secure
            </p>
          </div>
        </div>

        <Button 
          onClick={handleConnect} 
          className="w-full"
          size="lg"
        >
          <LogIn className="mr-2 h-4 w-4" />
          Connect {orgName} Account
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          This secure connection enables automated registration
        </p>
      </CardContent>

      <OAuthConnectDialog
        open={showLoginDialog}
        onOpenChange={setShowLoginDialog}
        provider={provider}
        orgName={orgName}
        orgRef={orgRef}
        onSuccess={handleLoginSuccess}
      />
    </Card>
  );
}
