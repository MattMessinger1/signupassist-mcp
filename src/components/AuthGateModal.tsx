import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";

// Auth gate modal simulating OAuth redirect flow (ChatGPT Apps SDK pattern)
// When auth is triggered inline, ChatGPT shows "Preparing authorization..." 
// then redirects to OAuth provider. This simulates that experience.

interface AuthGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  delegateEmail?: string; // Pre-populate with delegate email from form
}

export function AuthGateModal({ isOpen, onClose, onAuthSuccess, delegateEmail }: AuthGateModalProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose(); // Allow user to go back
      }
    }}>
      <SheetContent side="bottom" className="h-[100vh] overflow-y-auto bg-background">
        {/* OAuth redirect simulation header */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground border-b border-border pb-3 mb-4">
          <ExternalLink className="h-3 w-3" />
          <span>signupassist.ai</span>
          <span className="text-muted-foreground/50">•</span>
          <span>Secure authentication</span>
        </div>
        
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Go back to chat"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <SheetTitle>Connect to SignupAssist</SheetTitle>
          </div>
          <SheetDescription className="text-left">
            Sign in to authorize SignupAssist to complete this registration on your behalf.
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-4 pt-4">
          {delegateEmail && (
            <div className="text-sm bg-muted/50 rounded-lg p-3">
              <span className="text-muted-foreground">Using email: </span>
              <span className="font-medium text-foreground">{delegateEmail}</span>
            </div>
          )}
          
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <div className="font-medium text-foreground mb-2">SignupAssist will be able to:</div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>Register for programs on your behalf</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>Save your payment method securely</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>View your registration history</span>
            </div>
          </div>
        </div>
        
        <div className="mt-6">
          <Auth
            supabaseClient={supabase}
            view="sign_up"
            appearance={{ 
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: 'hsl(var(--primary))',
                    brandAccent: 'hsl(var(--primary))',
                  }
                }
              }
            }}
            providers={[]}
            theme="light"
            redirectTo={window.location.origin}
            additionalData={{
              email: delegateEmail
            }}
          />
        </div>
        
        <div className="mt-6 pt-4 border-t border-border text-center text-xs text-muted-foreground">
          By signing in, you agree to SignupAssist's Terms of Service and Privacy Policy.
        </div>
      </SheetContent>
    </Sheet>
  );
}