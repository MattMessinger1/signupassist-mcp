import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Wrench, ChevronDown, ChevronUp } from 'lucide-react';

export interface PrereqsPanelProps {
  checks: { id: string; label: string; status: 'pass' | 'fail' | 'unknown'; message: string }[];
  metadata?: {
    prerequisitesLoops?: number;
    programLoops?: number;
    urlsVisited?: string[];
    stops?: { reason: string; evidence?: any };
    fieldsFound?: number;
  };
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

const StatusBadge = ({ status }: { status: 'pass' | 'fail' | 'unknown' }) => {
  const variants = {
    pass: { icon: CheckCircle2, label: 'Pass', className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800' },
    fail: { icon: XCircle, label: 'Required', className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800' },
    unknown: { icon: Loader2, label: 'Checking', className: 'bg-muted text-muted-foreground border-muted-foreground/20' }
  };
  
  const variant = variants[status];
  const Icon = variant.icon;
  
  return (
    <Badge variant="outline" className={`${variant.className} flex items-center gap-1.5 px-2.5 py-0.5`}>
      <Icon className={`h-3 w-3 ${status === 'unknown' ? 'animate-spin' : ''}`} />
      <span className="text-xs font-medium">{variant.label}</span>
    </Badge>
  );
};

export default function PrereqsPanel({ 
  checks = [], 
  metadata,
  onRecheck,
  onContinue
}: PrereqsPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  
  // Debug logging
  console.log('[PrereqsPanel] Rendering with checks:', checks);
  console.log('[PrereqsPanel] Metadata:', metadata);
  
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-2xl mx-auto"
    >
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
                  key={prereq.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  {index > 0 && <Separator className="my-3" />}
                  <div
                    className={`flex items-start gap-4 p-4 rounded-lg transition-colors ${
                      prereq.status === 'pass' 
                        ? 'bg-green-50/30 dark:bg-green-950/10' 
                        : prereq.status === 'fail'
                        ? 'bg-red-50/30 dark:bg-red-950/10'
                        : 'bg-muted/20'
                    }`}
                  >
                    <StatusIcon status={prereq.status} />
                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">
                          {prereq.label}
                        </p>
                        <StatusBadge status={prereq.status} />
                      </div>
                      {prereq.message && (
                        <p className="text-sm text-muted-foreground">
                          {prereq.message}
                        </p>
                      )}
                    </div>
                    {prereq.status === 'fail' && (
                      <Button variant="outline" size="sm" className="flex-shrink-0 gap-2">
                        <Wrench className="h-3.5 w-3.5" />
                        Fix
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        
        {/* Discovery Details Toggle */}
        {metadata && hasChecks && (
          <div className="mt-6 pt-4 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full justify-between text-muted-foreground hover:text-foreground"
            >
              <span className="text-xs font-medium">Discovery Details</span>
              {showDetails ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            
            <AnimatePresence>
              {showDetails && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 space-y-2 text-xs text-muted-foreground"
                >
                  {metadata.prerequisitesLoops !== undefined && (
                    <div className="flex justify-between">
                      <span>Prerequisite Loops:</span>
                      <span className="font-mono">{metadata.prerequisitesLoops}</span>
                    </div>
                  )}
                  {metadata.programLoops !== undefined && (
                    <div className="flex justify-between">
                      <span>Program Loops:</span>
                      <span className="font-mono">{metadata.programLoops}</span>
                    </div>
                  )}
                  {metadata.fieldsFound !== undefined && (
                    <div className="flex justify-between">
                      <span>Fields Found:</span>
                      <span className="font-mono">{metadata.fieldsFound}</span>
                    </div>
                  )}
                  {metadata.urlsVisited && metadata.urlsVisited.length > 0 && (
                    <div>
                      <div className="font-medium mb-1">URLs Visited:</div>
                      <ul className="space-y-1 pl-3">
                        {metadata.urlsVisited.map((url, i) => (
                          <li key={i} className="font-mono text-[10px] truncate" title={url}>
                            {url}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {metadata.stops && (
                    <div className="flex justify-between">
                      <span>Stop Reason:</span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {metadata.stops.reason}
                      </Badge>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Card>

      <div className="flex gap-3 justify-end pt-4 border-t">
        {onRecheck && (
          <Button
            variant="outline"
            onClick={onRecheck}
            disabled={isChecking}
            aria-label="Recheck prerequisites"
            className="min-w-[120px]"
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
          aria-label="Continue to program questions"
          className="min-w-[200px]"
        >
          Continue
        </Button>
      </div>
    </motion.div>
  );
}
