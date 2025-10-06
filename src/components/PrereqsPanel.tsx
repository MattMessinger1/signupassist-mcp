import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface Props {
  orgRef: string;
  credentialId: string;
  prerequisiteChecks?: PrerequisiteCheck[];
  onRecheck?: () => void;
  onReadyToContinue?: () => void;
}

interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail' | 'unknown';
  message?: string;
}

const StatusIcon = ({ status }: { status: 'pass' | 'fail' | 'unknown' }) => {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />;
    case 'fail':
      return <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />;
    case 'unknown':
      return <Loader2 className="h-5 w-5 text-muted-foreground animate-spin flex-shrink-0" />;
  }
};

export default function PrerequisitesPanel({ 
  prerequisiteChecks = [], 
  onRecheck,
  onReadyToContinue 
}: Props) {
  const allPassed = prerequisiteChecks.length > 0 && prerequisiteChecks.every(p => p.status === 'pass');
  const hasFailed = prerequisiteChecks.some(p => p.status === 'fail');
  const isChecking = prerequisiteChecks.some(p => p.status === 'unknown');

  const handleContinue = () => {
    if (allPassed && onReadyToContinue) {
      onReadyToContinue();
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold mb-2">Account Prerequisites</h2>
        <p className="text-muted-foreground">
          System verified your account automatically
        </p>
      </div>

      <Card className="p-6">
        {prerequisiteChecks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p>Loading prerequisites...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {prerequisiteChecks.map((prereq, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 p-4 rounded-lg border transition-all animate-fade-in ${
                  prereq.status === 'pass' 
                    ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900' 
                    : prereq.status === 'fail'
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                    : 'bg-muted/30 border-border'
                }`}
              >
                <StatusIcon status={prereq.status} />
                <div className="flex-1 space-y-1 min-w-0">
                  <p className="font-medium text-sm">
                    {prereq.check}
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
              </div>
            ))}
          </div>
        )}
      </Card>

      {allPassed && (
        <Alert className="border-green-600 bg-green-50 dark:bg-green-950/20 animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900 dark:text-green-100">
            All prerequisites met – You can continue
          </AlertDescription>
        </Alert>
      )}

      {hasFailed && (
        <Alert className="border-red-600 bg-red-50 dark:bg-red-950/20 animate-fade-in">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-900 dark:text-red-100">
            Action required – Please resolve failed checks before continuing
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 justify-end sticky bottom-0 bg-background pt-4 border-t">
        {onRecheck && (
          <Button
            variant="outline"
            onClick={onRecheck}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Recheck Prerequisites'
            )}
          </Button>
        )}
        <Button
          onClick={handleContinue}
          disabled={!allPassed}
          size="lg"
        >
          Continue to Registration
        </Button>
      </div>
    </div>
  );
}
