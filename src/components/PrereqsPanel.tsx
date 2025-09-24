import { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail' | 'unknown';
  message?: string;
}

interface PrereqsPanelProps {
  provider: string;
  credentialId?: string;
  onResultsChange: (results: PrerequisiteCheck[]) => void;
}

export function PrereqsPanel({ provider, credentialId, onResultsChange }: PrereqsPanelProps) {
  const [results, setResults] = useState<PrerequisiteCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  const checkPrerequisites = async () => {
    if (!credentialId) {
      toast({
        title: 'Credential Required',
        description: 'Please select login credentials before checking prerequisites.',
        variant: 'destructive',
      });
      return;
    }

    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-prerequisites', {
        body: {
          provider,
          credential_id: credentialId
        }
      });

      if (error) throw error;

      const checkResults: PrerequisiteCheck[] = [
        {
          check: 'account',
          status: data.account ? 'pass' : 'fail',
          message: data.account ? 'Account verified' : 'Account not found or invalid'
        },
        {
          check: 'membership',
          status: data.membership ? 'pass' : 'fail',
          message: data.membership ? 'Active membership found' : 'No active membership'
        },
        {
          check: 'stored_payment_method',
          status: data.stored_payment_method ? 'pass' : 'fail',
          message: data.stored_payment_method ? 'Payment method on file' : 'No payment method stored'
        }
      ];

      setResults(checkResults);
      onResultsChange(checkResults);

      const allPassed = checkResults.every(r => r.status === 'pass');
      toast({
        title: allPassed ? 'Prerequisites Met' : 'Prerequisites Check Complete',
        description: allPassed 
          ? 'All requirements are satisfied!'
          : 'Some requirements need attention before creating the plan.',
        variant: allPassed ? 'default' : 'destructive',
      });

    } catch (error) {
      console.error('Error checking prerequisites:', error);
      toast({
        title: 'Check Failed',
        description: 'Could not verify prerequisites. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pass':
        return <Badge variant="secondary" className="bg-green-100 text-green-800">✓ Pass</Badge>;
      case 'fail':
        return <Badge variant="destructive">✗ Fail</Badge>;
      default:
        return <Badge variant="outline">? Unknown</Badge>;
    }
  };

  const allRequirementsMet = results.length > 0 && results.every(r => r.status === 'pass');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Prerequisites Check</span>
          <Button
            onClick={checkPrerequisites}
            disabled={checking || !credentialId}
            size="sm"
          >
            {checking ? (
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <AlertCircle className="h-4 w-4 mr-2" />
            )}
            {checking ? 'Checking...' : 'Check Prerequisites'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Click "Check Prerequisites" to verify account requirements.
          </p>
        ) : (
          <>
            {results.map((result) => (
              <div key={result.check} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(result.status)}
                  <div>
                    <div className="font-medium capitalize">
                      {result.check.replace('_', ' ')}
                    </div>
                    {result.message && (
                      <div className="text-sm text-muted-foreground">
                        {result.message}
                      </div>
                    )}
                  </div>
                </div>
                {getStatusBadge(result.status)}
              </div>
            ))}
            
            {!allRequirementsMet && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">
                    Action Required
                  </span>
                </div>
                <p className="text-sm text-amber-700 mt-1">
                  Please address the failed requirements before creating your plan.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}