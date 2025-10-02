import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
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
  const [hasChecked, setHasChecked] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Auto-check prerequisites when all required fields are available
  useEffect(() => {
    if (credentialId && childId && !hasChecked && !checking) {
      checkPrerequisites();
    }
  }, [credentialId, childId]);

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
      setHasChecked(true);

      if (data.overall_status === 'ready') {
        toast({
          title: 'Prerequisites Passed',
          description: 'All account requirements verified!',
        });
      } else {
        toast({
          title: 'Prerequisites Failed',
          description: 'Please address the issues below before continuing.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error checking prerequisites:', error);
      const message = (error as any)?.message || (error as any)?.error || 'Prerequisites check failed';
      toast({
        title: 'Prerequisites Check Failed',
        description: message,
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
    <>
      {checking && results.length === 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking account prerequisites...</span>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {!checking && (
            <div className="flex justify-end">
              <Button
                onClick={checkPrerequisites}
                disabled={checking || !credentialId}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Recheck
              </Button>
            </div>
          )}
          
          <div className="space-y-3">
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
          </div>
          
          {!allRequirementsMet && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  Action Required
                </span>
              </div>
              <p className="text-sm text-amber-700 mt-1">
                Please resolve the issues above before continuing.
              </p>
            </div>
          )}

          {allRequirementsMet && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">
                  All Requirements Met
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}