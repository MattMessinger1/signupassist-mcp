import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ConnectAccountCardProps {
  provider: string;
  orgName: string;
  orgRef: string;
}

export function ConnectAccountCard({ provider, orgName, orgRef }: ConnectAccountCardProps) {
  const navigate = useNavigate();

  const handleConnect = () => {
    // Navigate to credentials page with provider context
    navigate('/credentials', { 
      state: { 
        provider,
        orgName,
        orgRef,
        returnTo: '/'
      }
    });
  };

  return (
    <Card className="w-full max-w-md border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Connect Your Account</CardTitle>
        </div>
        <CardDescription>
          Securely connect to {orgName} to browse classes and register
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
          Connect {orgName} Account
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          This connection allows me to help you register for classes
        </p>
      </CardContent>
    </Card>
  );
}
