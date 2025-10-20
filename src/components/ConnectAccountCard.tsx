import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, LogIn, UserPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import { LoginCredentialDialog } from "./LoginCredentialDialog";

interface ConnectAccountCardProps {
  provider: string;
  orgName: string;
  orgRef: string;
}

export function ConnectAccountCard({ provider, orgName, orgRef }: ConnectAccountCardProps) {
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const handleSecureLogin = () => {
    setShowLoginDialog(true);
  };

  const handleLoginSuccess = () => {
    // TODO: Registration and class browsing flow will continue here in a future prompt pack
    toast({
      title: "Account Connected ✅",
      description: `Your ${orgName} account is now connected. Next, I'll help you browse classes... (placeholder — browsing flow coming soon)`,
      duration: 5000,
    });
  };

  const handleCreateAccount = () => {
    // Construct signup URL based on provider
    let signupUrl = '';
    
    if (provider === 'skiclubpro') {
      // Extract base domain from orgRef
      const baseDomain = orgRef === 'blackhawk-ski-club'
        ? 'blackhawk.skiclubpro.team'
        : `${orgRef.replace(/[^a-z0-9-]/g, '').toLowerCase()}.skiclubpro.team`;
      
      signupUrl = `https://${baseDomain}/register`;
    } else {
      // Fallback for other providers
      signupUrl = `https://${provider}.com/signup`;
    }

    // Open signup page in new tab
    window.open(signupUrl, '_blank', 'noopener,noreferrer');
    
    toast({
      title: "Account Creation",
      description: `Opening ${orgName}'s signup page in a new tab...`,
    });
  };

  return (
    <Card className="w-full max-w-md border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Connect Your {orgName} Account</CardTitle>
        </div>
        <CardDescription>
          Log in to your {orgName} account so I can pull in the latest classes. You will authenticate on {orgName}'s site – we won't see or store your password.
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

        <div className="space-y-2">
          <Button 
            onClick={handleSecureLogin} 
            className="w-full"
            size="lg"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Log in securely
          </Button>

          <Button 
            onClick={handleCreateAccount} 
            variant="outline"
            className="w-full"
            size="lg"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Create Account
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          This connection allows me to help you register for classes
        </p>
      </CardContent>

      <LoginCredentialDialog
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

