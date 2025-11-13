import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Trash2, RefreshCw, Database, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CachedProgram {
  org_ref: string;
  category: string;
  provider: string;
  cached_at: string;
  programs_by_theme: any;
  metadata: any;
}

export function Phase3TestingPanel() {
  const [isClearing, setIsClearing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cachedPrograms, setCachedPrograms] = useState<CachedProgram[]>([]);
  const { toast } = useToast();

  // Step 1: Clear cache
  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      const { error } = await supabase
        .from('cached_programs')
        .delete()
        .eq('org_ref', 'blackhawk-ski-club');

      if (error) throw error;

      toast({
        title: 'Cache Cleared',
        description: 'All cached programs for blackhawk-ski-club have been deleted.',
      });

      setCachedPrograms([]);
    } catch (error: any) {
      console.error('Failed to clear cache:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsClearing(false);
    }
  };

  // Step 2: Trigger refresh-program-cache
  const handleRefreshCache = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-program-cache', {
        body: {}
      });

      if (error) throw error;

      toast({
        title: 'Cache Refresh Started',
        description: 'Check the edge function logs for progress. This may take a few minutes.',
      });

      console.log('Refresh result:', data);

      // Auto-load cached programs after refresh
      setTimeout(() => handleLoadCachedPrograms(), 3000);
    } catch (error: any) {
      console.error('Failed to refresh cache:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Step 3: Load and verify cached programs
  const handleLoadCachedPrograms = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('cached_programs')
        .select('org_ref, category, provider, cached_at, programs_by_theme, metadata')
        .eq('org_ref', 'blackhawk-ski-club')
        .order('cached_at', { ascending: false });

      if (error) throw error;

      setCachedPrograms(data || []);
      
      // Count total programs across all themes
      const totalPrograms = (data || []).reduce((sum, cache) => {
        const themes = cache.programs_by_theme || {};
        return sum + Object.values(themes).reduce((themeSum: number, programs: any) => 
          themeSum + (Array.isArray(programs) ? programs.length : 0), 0);
      }, 0);
      
      toast({
        title: 'Cache Entries Loaded',
        description: `Found ${data?.length || 0} cache entries with ${totalPrograms} total programs`,
      });
    } catch (error: any) {
      console.error('Failed to load programs:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phase 3: Manual Testing & Validation</CardTitle>
        <CardDescription>
          Verify cache population works end-to-end
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Test Steps */}
        <div className="space-y-4">
          {/* Step 1: Clear Cache */}
          <div className="flex items-start gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
              1
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="font-semibold">Clear Existing Cache</h3>
              <p className="text-sm text-muted-foreground">
                Delete all cached programs for blackhawk-ski-club to start fresh
              </p>
              <Button 
                onClick={handleClearCache} 
                disabled={isClearing}
                variant="destructive"
                size="sm"
              >
                {isClearing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear Cache
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Step 2: Trigger Refresh */}
          <div className="flex items-start gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
              2
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="font-semibold">Manually Trigger refresh-program-cache</h3>
              <p className="text-sm text-muted-foreground">
                Call the edge function to scrape and cache programs
              </p>
              <Button 
                onClick={handleRefreshCache} 
                disabled={isRefreshing}
                size="sm"
              >
                {isRefreshing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Trigger Refresh
                  </>
                )}
              </Button>
              <Alert className="mt-2">
                <AlertDescription className="text-xs">
                  This may take 2-5 minutes. Check edge function logs for progress.
                </AlertDescription>
              </Alert>
            </div>
          </div>

          {/* Step 3: Verify Cache */}
          <div className="flex items-start gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
              3
            </div>
            <div className="flex-1 space-y-2">
              <h3 className="font-semibold">Verify Cache Population</h3>
              <p className="text-sm text-muted-foreground">
                Load cached programs and verify they have complete data
              </p>
              <Button 
                onClick={handleLoadCachedPrograms} 
                disabled={isLoading}
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Load Cached Programs
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Results Display */}
        {cachedPrograms.length > 0 && (
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h3 className="font-semibold">Cache Entries ({cachedPrograms.length})</h3>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {cachedPrograms.map((cache, idx) => {
                const themes = cache.programs_by_theme || {};
                const programCount: number = (Object.values(themes) as any[]).reduce((sum: number, programs: any) => 
                  sum + (Array.isArray(programs) ? programs.length : 0), 0) as number;
                
                return (
                  <div
                    key={idx}
                    className="p-3 border rounded-lg bg-muted/50 text-sm"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex gap-3">
                        <span className="font-medium">{cache.org_ref}</span>
                        <span className="text-muted-foreground">•</span>
                        <span>{cache.category}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-green-600 font-medium">{String(programCount)} programs</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(cache.cached_at).toLocaleString()}
                      </span>
                    </div>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View programs by theme
                      </summary>
                      <div className="mt-2 pl-4 space-y-1">
                        {Object.entries(themes).map(([theme, programs]: [string, any]) => {
                          const count = Array.isArray(programs) ? programs.length : 0;
                          return (
                            <div key={theme}>
                              <span className="font-medium">{theme}:</span> {String(count)} programs
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Success Criteria */}
        <div className="pt-4 border-t">
          <h3 className="font-semibold mb-2">Success Criteria ✅</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• Cache contains programs with complete field schemas</li>
            <li>• ChatGPT reads from cache successfully</li>
            <li>• Logs show MCP authentication and extraction working</li>
            <li>• Response time is &lt;100ms</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
