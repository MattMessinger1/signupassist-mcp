import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, LogIn, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

interface ConnectAccountCardProps {
  provider: string;
  orgName: string;
  orgRef: string;
}

export function ConnectAccountCard({ provider, orgName, orgRef }: ConnectAccountCardProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const handleSecureLogin = async () => {
    setIsLoading(true);
    
    try {
      // For now, navigate to credentials page to add credentials
      // In future, this will trigger browserbase login flow
      navigate('/credentials', { 
        state: { 
          provider,
          orgName,
          orgRef,
          returnTo: '/',
          autoLogin: true
        }
      });
      
      toast({
        title: "Secure Login",
        description: `Redirecting to connect your ${orgName} account...`,
      });
    } catch (error) {
      console.error('Error starting login:', error);
      toast({
        title: "Login Error",
        description: "Failed to start secure login. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
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
            disabled={isLoading}
          >
            <LogIn className="mr-2 h-4 w-4" />
            {isLoading ? "Connecting..." : "Log in securely"}
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
    </Card>
  );
}

