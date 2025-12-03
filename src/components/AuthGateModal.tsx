import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

// Auth gate modal for lazy authentication at payment step (ChatGPT fullscreen compliance)

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
      <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <SheetTitle>Almost there! 🎉</SheetTitle>
          </div>
          <div className="space-y-2 pt-2 text-sm text-muted-foreground">
            <div>Create an account to complete your registration.</div>
            {delegateEmail && (
              <div className="font-medium pt-2">
                Using email: <span className="text-primary">{delegateEmail}</span>
              </div>
            )}
            <div className="text-xs space-y-1 pt-2">
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Your form data is saved</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>Quick checkout next time</span>
              </div>
              <div className="flex items-center gap-2">
                <span>✓</span>
                <span>View registration history</span>
              </div>
            </div>
          </div>
        </SheetHeader>
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
      </SheetContent>
    </Sheet>
  );
}