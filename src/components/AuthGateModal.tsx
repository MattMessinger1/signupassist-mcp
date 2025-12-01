import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";

// Auth gate modal for lazy authentication at payment step

interface AuthGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
}

export function AuthGateModal({ isOpen, onClose, onAuthSuccess }: AuthGateModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Almost there! 🎉</DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <p>Create an account to complete your registration.</p>
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
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Auth
            supabaseClient={supabase}
            appearance={{ theme: ThemeSupa }}
            providers={[]}
            theme="light"
            redirectTo={window.location.origin}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
