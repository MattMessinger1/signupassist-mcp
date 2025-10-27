import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

interface ExecutionConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program: string;
  child: string;
  maxAmount: string;
  validUntil: string;
  onAuthorize: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ExecutionConsentDialog({
  open,
  onOpenChange,
  program,
  child,
  maxAmount,
  validUntil,
  onAuthorize,
  onCancel,
  isLoading = false,
}: ExecutionConsentDialogProps) {
  const consentMessage = [
    `Ready to set up automatic registration for ${child} in ${program}?`,
    '',
    '**🔐 Authorization & Consent**',
    '',
    '✓ **What we\'re asking permission for:**',
    '  By authorizing this plan, you allow SignupAssist to:',
    '  • Log into your account when registration opens',
    `  • Fill out and submit the registration form for ${child}`,
    `  • Process payment up to ${maxAmount} using your saved payment method`,
    '',
    '✓ **How it works:**',
    '  We create a cryptographically signed "mandate" (permission token)',
    '  that authorizes these specific actions. This mandate is valid until',
    `  ${validUntil} and cannot be reused after that.`,
    '',
    '✓ **Security guarantees:**',
    '  • Your credentials are encrypted end-to-end',
    '  • We never see your full credit card number',
    '  • Registration happens in an isolated browser session',
    '  • Session is destroyed immediately after completion',
    '',
    '✓ **Full transparency:**',
    '  Every action is logged in your audit trail, including:',
    '  • When the mandate was issued',
    '  • What actions were attempted',
    '  • Screenshots of key moments (form filled, confirmation)',
    '  • Final outcome (success or any blockers)',
    '',
    '  [View your audit trail →](/mandates-audit)',
    '',
    '✓ **Your control:**',
    '  • You can revoke this at any time from your audit trail',
    '  • Mandate expires automatically after registration',
    '  • If we hit a blocker (CAPTCHA, new waiver), we\'ll pause and notify you',
    '',
    `💰 **Cost Limit:** ${maxAmount}`,
    `⏰ **Valid Until:** ${validUntil}`,
    '',
    'Say "authorize" to proceed, or "cancel" to stop.',
  ].join('\n');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <DialogTitle>🎯 Authorization Required</DialogTitle>
          </div>
        </DialogHeader>

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <div className="whitespace-pre-wrap text-sm space-y-3">
            {consentMessage.split('\n').map((line, idx) => {
              // Render bold sections
              if (line.startsWith('**') && line.endsWith('**')) {
                return (
                  <p key={idx} className="font-semibold text-base mt-4 mb-2">
                    {line.replace(/\*\*/g, '')}
                  </p>
                );
              }
              
              // Render bullet points
              if (line.startsWith('✓') || line.startsWith('•')) {
                return (
                  <p key={idx} className="flex items-start gap-2">
                    <span className="text-green-600 dark:text-green-400 font-bold">
                      {line[0]}
                    </span>
                    <span className="flex-1">{line.slice(1).trim()}</span>
                  </p>
                );
              }
              
              // Render cost/time info
              if (line.startsWith('💰') || line.startsWith('⏰')) {
                return (
                  <p key={idx} className="font-semibold text-base bg-blue-50 dark:bg-blue-950 p-2 rounded">
                    {line}
                  </p>
                );
              }
              
              // Render regular lines
              if (line.trim()) {
                return <p key={idx}>{line}</p>;
              }
              
              return <div key={idx} className="h-2" />;
            })}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button
            onClick={onAuthorize}
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading ? 'Authorizing...' : 'Authorize'}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
