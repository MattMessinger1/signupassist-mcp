/**
 * OAuth Connect Dialog
 * 
 * ChatGPT App Store Compliant: No in-app password collection.
 * For API-first providers, we use direct API access (no user credentials needed).
 * For OAuth providers, we redirect to the provider's OAuth consent page.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, ExternalLink, Loader2, CheckCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface OAuthConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  orgName: string;
  orgRef: string;
  onSuccess?: () => void;
}

/**
 * OAuth Connect Dialog
 * 
 * NOTE: For Bookeo (API-first provider), no user login is needed.
 * SignupAssist has direct API access via BOOKEO_API_KEY and BOOKEO_SECRET_KEY.
 * 
 * This component is kept for potential future OAuth providers but currently
 * displays a message that no account connection is required for Bookeo.
 */
export function OAuthConnectDialog({
  open,
  onOpenChange,
  provider,
  orgName,
  orgRef,
  onSuccess
}: OAuthConnectDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const handleConnect = async () => {
    setIsLoading(true);
    
    try {
      // For Bookeo (API-first), no OAuth needed - just simulate success
      if (provider === 'bookeo') {
        // API-first provider - no user login required
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setConnected(true);
        toast({
          title: "Ready to Browse",
          description: `You can browse ${orgName} programs directly - no account login needed!`,
        });
        
        setTimeout(() => {
          onSuccess?.();
          onOpenChange(false);
        }, 1500);
        
        return;
      }
      
      // For OAuth providers (future), redirect to OAuth consent page
      // This would be implemented when we add OAuth-based providers
      toast({
        title: "OAuth Not Implemented",
        description: "This provider requires OAuth which is coming soon.",
        variant: "destructive",
      });
      
    } catch (error) {
      console.error('Connect error:', error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
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
            {provider === 'bookeo' ? (
              <>SignupAssist has direct access to browse {orgName} programs. No account login is required.</>
            ) : (
              <>You'll be redirected to {orgName}'s secure login page to authorize access.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {connected ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">Connected!</p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Ready to browse programs...
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                    Privacy & Security
                  </p>
                  
                  <div className="space-y-2 text-xs text-blue-800 dark:text-blue-200">
                    <div className="flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                      <p>
                        <strong>No passwords collected:</strong> SignupAssist never asks for or stores your {orgName} password.
                      </p>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                      <p>
                        <strong>API-first access:</strong> We use secure API connections to browse programs on your behalf.
                      </p>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 mt-1.5 flex-shrink-0" />
                      <p>
                        <strong>Full transparency:</strong> Every action is logged in your{' '}
                        <a 
                          href="/mandates-audit" 
                          target="_blank" 
                          className="underline font-semibold hover:text-blue-600 dark:hover:text-blue-300"
                        >
                          audit trail
                        </a>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
            disabled={isLoading || connected}
          >
            Cancel
          </Button>
          
          {!connected && (
            <Button
              onClick={handleConnect}
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : provider === 'bookeo' ? (
                'Continue'
              ) : (
                <>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Connect via {orgName}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export for backward compatibility - use OAuthConnectDialog instead
export { OAuthConnectDialog as LoginCredentialDialog };
