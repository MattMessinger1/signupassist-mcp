import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ExternalLink, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

// Auth gate modal using OTP code entry for ChatGPT App Store compliance
// Users enter 6-digit code from email - stays in same tab, no redirect needed

interface AuthGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
  delegateEmail?: string;
}

type AuthStep = 'email' | 'otp';

export function AuthGateModal({ isOpen, onClose, onAuthSuccess, delegateEmail }: AuthGateModalProps) {
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState(delegateEmail || '');
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        }
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Check your email for a 6-digit code!');
      setStep('otp');
    } catch (err) {
      toast.error('Failed to send code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'email'
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Signed in successfully!');
      onAuthSuccess();
    } catch (err) {
      toast.error('Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'otp') {
      setStep('email');
      setOtpCode('');
    } else {
      onClose();
    }
  };

  const resetAndClose = () => {
    setStep('email');
    setOtpCode('');
    setEmail(delegateEmail || '');
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) resetAndClose();
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
              onClick={handleBack}
              className="h-8 w-8"
              aria-label={step === 'otp' ? 'Go back to email' : 'Go back to chat'}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <SheetTitle>
              {step === 'email' ? 'Connect to SignupAssist' : 'Enter Verification Code'}
            </SheetTitle>
          </div>
          <SheetDescription className="text-left">
            {step === 'email' 
              ? 'Enter your email to receive a 6-digit verification code.'
              : `We sent a code to ${email}`
            }
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-4 pt-4">
          {step === 'email' ? (
            <>
              {delegateEmail && (
                <div className="text-sm bg-muted/50 rounded-lg p-3">
                  <span className="text-muted-foreground">Using email: </span>
                  <span className="font-medium text-foreground">{delegateEmail}</span>
                </div>
              )}
              
              <div className="flex items-center gap-2 text-sm bg-primary/10 rounded-lg p-3 border border-primary/20">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-foreground">We'll send you a 6-digit code - enter it here to sign in!</span>
              </div>
              
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading || !email}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Verification Code'
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm bg-primary/10 rounded-lg p-3 border border-primary/20">
                <Mail className="h-4 w-4 text-primary" />
                <span className="text-foreground">Enter the 6-digit code from your email</span>
              </div>
              
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">Verification Code</Label>
                  <Input
                    id="otp"
                    type="text"
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    disabled={isLoading}
                    className="text-center text-2xl tracking-widest font-mono"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading || otpCode.length !== 6}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify & Sign In'
                  )}
                </Button>
                <Button 
                  type="button" 
                  variant="ghost" 
                  className="w-full text-muted-foreground"
                  onClick={handleSendOtp}
                  disabled={isLoading}
                >
                  Resend code
                </Button>
              </form>
            </>
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
        
        <div className="mt-6 pt-4 border-t border-border text-center text-xs text-muted-foreground">
          By signing in, you agree to SignupAssist's Terms of Service and Privacy Policy.
        </div>
      </SheetContent>
    </Sheet>
  );
}
