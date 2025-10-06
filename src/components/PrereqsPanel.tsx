import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

export interface PrereqsPanelProps {
  checks: { check: string; status: 'pass' | 'fail' | 'unknown'; message?: string }[];
  onRecheck?: () => void;
  onContinue?: () => void;
}

// Humanize snake_case to Title Case
const humanizeLabel = (label: string): string => {
  return label
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const StatusIcon = ({ status }: { status: 'pass' | 'fail' | 'unknown' }) => {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" aria-hidden="true" />;
    case 'fail':
      return <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" aria-hidden="true" />;
    case 'unknown':
      return <Loader2 className="h-5 w-5 text-muted-foreground animate-spin flex-shrink-0" aria-hidden="true" />;
  }
};

export default function PrereqsPanel({ 
  checks = [], 
  onRecheck,
  onContinue
}: PrereqsPanelProps) {
  const allPassed = checks.length > 0 && checks.every(c => c.status === 'pass');
  const hasFailed = checks.some(c => c.status === 'fail');
  const isChecking = checks.some(c => c.status === 'unknown');
  const hasChecks = checks.length > 0;

  // Determine banner state
  const getBannerConfig = () => {
    if (allPassed) {
      return {
        variant: 'success' as const,
        icon: CheckCircle2,
        message: 'All prerequisites met. You may continue.',
        className: 'border-green-600 bg-green-50 dark:bg-green-950/20 text-green-900 dark:text-green-100'
      };
    }
    if (hasFailed) {
      return {
        variant: 'error' as const,
        icon: AlertTriangle,
        message: 'Some actions required before continuing.',
        className: 'border-red-600 bg-red-50 dark:bg-red-950/20 text-red-900 dark:text-red-100'
      };
    }
    return {
      variant: 'neutral' as const,
      icon: Loader2,
      message: 'Verifying your account…',
      className: 'border-muted bg-muted/20 text-muted-foreground'
    };
  };

  const banner = getBannerConfig();
  const BannerIcon = banner.icon;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold mb-2">Account Prerequisites</h2>
        <p className="text-muted-foreground">
          System verified your account automatically
        </p>
      </div>

      {/* Summary Banner */}
      <AnimatePresence mode="wait">
        {hasChecks && (
          <motion.div
            key={banner.variant}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <Alert className={banner.className} role="status" aria-live="polite">
              <BannerIcon className={`h-4 w-4 ${banner.variant === 'neutral' ? 'animate-spin' : ''}`} />
              <AlertDescription>{banner.message}</AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="p-6">
        {!hasChecks ? (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p>Loading prerequisites...</p>
          </div>
        ) : (
          <div className="space-y-0">
            <AnimatePresence>
              {checks.map((prereq, index) => (
                <motion.div
                  key={prereq.check}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  {index > 0 && <Separator className="my-3" />}
                  <div
                    className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                      prereq.status === 'pass' 
                        ? 'hover:bg-green-50/50 dark:hover:bg-green-950/10' 
                        : prereq.status === 'fail'
                        ? 'hover:bg-red-50/50 dark:hover:bg-red-950/10'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <StatusIcon status={prereq.status} />
                    <div className="flex-1 space-y-1 min-w-0">
                      <p className="font-medium text-sm">
                        {humanizeLabel(prereq.check)}
                      </p>
                      {prereq.message && (
                        <p className={`text-sm ${
                          prereq.status === 'pass' 
                            ? 'text-green-700 dark:text-green-300' 
                            : prereq.status === 'fail'
                            ? 'text-red-700 dark:text-red-300'
                            : 'text-muted-foreground'
                        }`}>
                          {prereq.message}
                        </p>
                      )}
                    </div>
                    {prereq.status === 'fail' && (
                      <Button variant="outline" size="sm" className="flex-shrink-0">
                        Fix
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Card>

      <div className="flex gap-3 justify-end sticky bottom-0 bg-background pt-4 border-t">
        {onRecheck && (
          <Button
            variant="outline"
            onClick={onRecheck}
            disabled={isChecking}
            aria-label="Recheck prerequisites"
          >
            {isChecking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Recheck'
            )}
          </Button>
        )}
        <Button
          onClick={onContinue}
          disabled={!allPassed}
          size="lg"
          aria-label="Continue to registration"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
