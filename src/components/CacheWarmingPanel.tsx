import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface WarmResult {
  org_ref: string;
  category: string;
  status: string;
  error?: string;
}

export function CacheWarmingPanel() {
  const [isWarming, setIsWarming] = useState(false);
  const [results, setResults] = useState<WarmResult[] | null>(null);
  const [orgRef, setOrgRef] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const { toast } = useToast();

  const handleWarmCache = async () => {
    setIsWarming(true);
    setResults(null);

    try {
      const body = orgRef === 'all' 
        ? {} 
        : { org_ref: orgRef, category, force_refresh: true };

      const { data, error } = await supabase.functions.invoke('warm-cache-authenticated', {
        body
      });

      if (error) {
        throw error;
      }

      setResults(data.results);
      
      const successCount = data.summary.success;
      const failedCount = data.summary.failed;

      toast({
        title: 'Cache Warming Complete',
        description: `Successfully warmed ${successCount} cache(s). ${failedCount > 0 ? `${failedCount} failed.` : ''}`,
        variant: successCount > 0 && failedCount === 0 ? 'default' : 'destructive'
      });

    } catch (error: any) {
      console.error('Cache warming failed:', error);
      toast({
        title: 'Cache Warming Failed',
        description: error.message || 'An unexpected error occurred',
        variant: 'destructive'
      });
    } finally {
      setIsWarming(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Authenticated Cache Warming
        </CardTitle>
        <CardDescription>
          Populate cache using system mandate and credentials (Phase 3)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This uses the system mandate (SYSTEM_MANDATE_JWS) to authenticate and warm the cache with fresh program data.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Organization</label>
            <Select value={orgRef} onValueChange={setOrgRef} disabled={isWarming}>
              <SelectTrigger>
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Organizations</SelectItem>
                <SelectItem value="blackhawk-ski-club">Blackhawk Ski Club</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <Select 
              value={category} 
              onValueChange={setCategory} 
              disabled={isWarming || orgRef === 'all'}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="lessons">Lessons</SelectItem>
                <SelectItem value="teams">Teams</SelectItem>
                <SelectItem value="races">Races</SelectItem>
                <SelectItem value="camps">Camps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button 
          onClick={handleWarmCache} 
          disabled={isWarming}
          className="w-full"
        >
          {isWarming ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Warming Cache...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              Warm Cache
            </>
          )}
        </Button>

        {results && results.length > 0 && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-medium">Results:</h4>
            <div className="space-y-2">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    result.status === 'success' 
                      ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' 
                      : 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.status === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    <span className="text-sm font-medium">
                      {result.org_ref}:{result.category}
                    </span>
                  </div>
                  {result.error && (
                    <span className="text-xs text-muted-foreground">{result.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
