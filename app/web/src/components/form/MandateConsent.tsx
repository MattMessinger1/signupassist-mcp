import { useState } from 'react';
import { Shield, Check, AlertCircle, Loader2 } from 'lucide-react';

interface MandateConsentProps {
  programName: string;
  childName: string;
  maxAmount: string;
  validUntil: string;
  opensAt?: Date;
  onAuthorize: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function MandateConsent({
  programName,
  childName,
  maxAmount,
  validUntil,
  opensAt,
  onAuthorize,
  onCancel,
  isLoading = false,
}: MandateConsentProps) {
  const [agreed, setAgreed] = useState(false);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(date);
  };

  const sections = [
    {
      title: "What we're asking permission for",
      icon: '✓',
      items: [
        'Log into your account when registration opens',
        `Fill out and submit the registration form for ${childName}`,
        `Process payment up to ${maxAmount} using your saved payment method`,
      ]
    },
    {
      title: 'How it works',
      icon: '✓',
      items: [
        'We create a cryptographically signed "mandate" (permission token)',
        `This mandate authorizes these specific actions until ${validUntil}`,
        'The mandate cannot be reused after expiration',
      ]
    },
    {
      title: 'Security guarantees',
      icon: '🔐',
      items: [
        'Your credentials are encrypted end-to-end',
        'We never see your full credit card number',
        'Registration happens in an isolated browser session',
        'Session is destroyed immediately after completion',
      ]
    },
    {
      title: 'Full transparency',
      icon: '📋',
      items: [
        'Every action is logged in your audit trail',
        'Screenshots captured at key moments (form filled, confirmation)',
        'Final outcome recorded (success or any blockers)',
      ]
    },
    {
      title: 'Your control',
      icon: '🎮',
      items: [
        'You can revoke this at any time from your audit trail',
        'Mandate expires automatically after registration',
        "If we hit a blocker (CAPTCHA, new waiver), we'll pause and notify you",
      ]
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Authorization Required</h2>
          <p className="text-sm text-muted-foreground">
            Set up automatic registration for {childName} in {programName}
          </p>
        </div>
      </div>

      {/* Scheduled Time Notice */}
      {opensAt && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
          <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">Scheduled Registration</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              We'll automatically register on {formatDate(opensAt)}
            </p>
          </div>
        </div>
      )}

      {/* Consent Sections */}
      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-2">
            <h3 className="font-semibold flex items-center gap-2">
              <span>{section.icon}</span>
              {section.title}
            </h3>
            <ul className="space-y-1 pl-6">
              {section.items.map((item, itemIdx) => (
                <li key={itemIdx} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-green-600 dark:text-green-400 mt-0.5">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Summary Box */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Cost Limit</p>
          <p className="font-semibold">{maxAmount}</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Valid Until</p>
          <p className="font-semibold">{validUntil}</p>
        </div>
      </div>

      {/* Agreement Checkbox */}
      <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <div className="text-sm">
          <span className="font-medium">I understand and authorize</span>
          <p className="text-muted-foreground mt-1">
            I authorize SignupAssist to act as my delegate and perform the actions described above
            on my behalf. I understand my credentials are encrypted and all actions are logged.
          </p>
        </div>
      </label>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onAuthorize}
          disabled={!agreed || isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating Mandate...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Authorize & Create Plan
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1 px-4 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
