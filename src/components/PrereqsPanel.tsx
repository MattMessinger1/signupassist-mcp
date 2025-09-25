import { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  childId?: string;
  onResultsChange: (results: PrerequisiteCheck[]) => void;
}

export function PrereqsPanel({ provider, credentialId, childId, onResultsChange }: PrereqsPanelProps) {
  const [results, setResults] = useState<PrerequisiteCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Helper function for showing function errors
  const showFunctionError = (error: any, action: string) => {
    const message = error?.message || `${action} failed. Please try again.`;
    toast({
      title: `${action} Failed`,
      description: message,
      variant: 'destructive',
    });
  };

  const checkPrerequisites = async () => {
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to check prerequisites.',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    if (!childId) {
      toast({
        title: 'Child Required',
        description: 'Please select or add a child first.',
        variant: 'destructive',
      });
      return;
    }

    if (!credentialId) {
      toast({
        title: 'Credentials Required',
        description: 'Please select login credentials before checking prerequisites.',
        variant: 'destructive',
      });
      return;
    }

    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-prerequisites', {
        body: {
          credential_id: credentialId,
          child_id: childId,
          provider: 'skiclubpro'
        }
      });

      if (error) throw error;

      const transformedResults = data.checks.map((check: any) => ({
        check: check.check,
        status: check.status,
        message: check.message,
      }));

      setResults(transformedResults);
      onResultsChange(transformedResults);

      toast({
        title: 'Prerequisites Checked',
        description: data.overall_status === 'ready' ? 'All checks passed!' : 'Some issues found.',
        variant: data.overall_status === 'ready' ? 'default' : 'destructive',
      });
    } catch (error) {
      console.error('Error checking prerequisites:', error);
      showFunctionError(error, 'Prerequisites Check');
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