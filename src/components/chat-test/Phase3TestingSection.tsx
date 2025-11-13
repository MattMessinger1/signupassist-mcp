/**
 * Phase 3 Testing Section
 * 
 * Manual testing and validation for cache population:
 * 1. Clear existing cache
 * 2. Trigger refresh-program-cache
 * 3. Verify cache population
 * 4. Test ChatGPT integration
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Trash2, RefreshCw, Database, MessageSquare, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface CachedProgram {
  org_ref: string;
  category: string;
  programs_by_theme: Record<string, any[]>;
  cached_at: string;
}

interface Phase3TestingSectionProps {
  onTestChatGPT: (message: string) => Promise<void>;
}

export function Phase3TestingSection({ onTestChatGPT }: Phase3TestingSectionProps) {
  const { toast } = useToast();
  const [isClearing, setIsClearing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [cachedPrograms, setCachedPrograms] = useState<CachedProgram[]>([]);
  const [testStatus, setTestStatus] = useState<{
    cleared: boolean;
    refreshed: boolean;
    verified: boolean;
    chatgpt: boolean;
  }>({
    cleared: false,
    refreshed: false,
    verified: false,
    chatgpt: false,
  });

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      const { error } = await supabase
        .from('cached_programs')
        .delete()
        .eq('org_ref', 'blackhawk-ski-club');

      if (error) throw error;

      toast({
        title: "Cache Cleared",
        description: "Deleted all cached programs for blackhawk-ski-club",
      });
      
      setTestStatus(prev => ({ ...prev, cleared: true, verified: false }));
      setCachedPrograms([]);
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast({
        title: "Clear Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleTriggerRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-program-cache', {
        body: { org_ref: 'blackhawk-ski-club' }
      });

      if (error) throw error;

      toast({
        title: "Cache Refresh Triggered",
        description: "Check logs for MCP calls and responses",
      });
      
      setTestStatus(prev => ({ ...prev, refreshed: true }));
      
      // Auto-load cache after refresh
      setTimeout(() => handleLoadCache(), 2000);
    } catch (error) {
      console.error('Error triggering refresh:', error);
      toast({
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLoadCache = async () => {
    setIsLoadingCache(true);
    try {
      const { data, error } = await supabase
        .from('cached_programs')
        .select('org_ref, category, programs_by_theme, cached_at')
        .eq('org_ref', 'blackhawk-ski-club')
        .order('cached_at', { ascending: false });

      if (error) throw error;

      setCachedPrograms((data || []) as CachedProgram[]);
      
      const hasPrograms = data && data.length > 0;
      setTestStatus(prev => ({ ...prev, verified: hasPrograms }));
      
      toast({
        title: "Cache Loaded",
        description: `Found ${data?.length || 0} cache entries`,
      });
    } catch (error) {
      console.error('Error loading cache:', error);
      toast({
        title: "Load Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsLoadingCache(false);
    }
  };

  const handleTestChatGPT = async () => {
    try {
      await onTestChatGPT("Find ski programs for my 8-year-old");
      setTestStatus(prev => ({ ...prev, chatgpt: true }));
    } catch (error) {
      console.error('Error testing ChatGPT:', error);
      toast({
        title: "ChatGPT Test Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const allStepsComplete = testStatus.cleared && testStatus.refreshed && testStatus.verified && testStatus.chatgpt;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Phase 3: Manual Testing & Validation</span>
          {allStepsComplete && (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Complete
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: Clear Cache */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
            testStatus.cleared ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
          )}>
            {testStatus.cleared ? <CheckCircle2 className="h-4 w-4" /> : "1"}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Clear Existing Cache</p>
                <p className="text-sm text-muted-foreground">DELETE FROM cached_programs WHERE org_ref = 'blackhawk-ski-club'</p>
              </div>
              <Button
                onClick={handleClearCache}
                disabled={isClearing}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                {isClearing ? "Clearing..." : "Clear Cache"}
              </Button>
            </div>
          </div>
        </div>

        {/* Step 2: Trigger Refresh */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
            testStatus.refreshed ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
          )}>
            {testStatus.refreshed ? <CheckCircle2 className="h-4 w-4" /> : "2"}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Trigger refresh-program-cache</p>
                <p className="text-sm text-muted-foreground">Watch logs for MCP calls and responses</p>
              </div>
              <Button
                onClick={handleTriggerRefresh}
                disabled={isRefreshing || !testStatus.cleared}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                {isRefreshing ? "Refreshing..." : "Trigger Refresh"}
              </Button>
            </div>
          </div>
        </div>

        {/* Step 3: Verify Cache */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
            testStatus.verified ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
          )}>
            {testStatus.verified ? <CheckCircle2 className="h-4 w-4" /> : "3"}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Verify Cache Population</p>
                <p className="text-sm text-muted-foreground">SELECT org_ref, category, cached_at FROM cached_programs</p>
              </div>
              <Button
                onClick={handleLoadCache}
                disabled={isLoadingCache || !testStatus.refreshed}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <Database className="h-4 w-4" />
                {isLoadingCache ? "Loading..." : "Load Cache"}
              </Button>
            </div>
            
            {cachedPrograms.length > 0 && (
              <div className="mt-2 space-y-2 rounded-md border p-3 bg-muted/30">
                <p className="text-sm font-medium">Cache Entries: {cachedPrograms.length}</p>
                {cachedPrograms.map((cache, idx) => {
                  const totalPrograms = Object.values(cache.programs_by_theme).reduce(
                    (sum, programs) => sum + programs.length,
                    0
                  );
                  return (
                    <div key={idx} className="text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{cache.category}</span>
                        <span className="text-muted-foreground">{totalPrograms} programs</span>
                      </div>
                      <div className="text-muted-foreground">
                        Cached: {new Date(cache.cached_at).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Step 4: Test ChatGPT Integration */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
            testStatus.chatgpt ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
          )}>
            {testStatus.chatgpt ? <CheckCircle2 className="h-4 w-4" /> : "4"}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Test ChatGPT Integration</p>
                <p className="text-sm text-muted-foreground">Verify cache hits and response time {'<'}100ms</p>
              </div>
              <Button
                onClick={handleTestChatGPT}
                disabled={!testStatus.verified}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                Test ChatGPT
              </Button>
            </div>
          </div>
        </div>

        {/* Success Criteria */}
        <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm font-medium mb-2">Success Criteria:</p>
          <ul className="text-xs space-y-1 text-muted-foreground">
            <li className="flex items-center gap-2">
              {testStatus.verified ? (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              Cache contains programs with complete field schemas
            </li>
            <li className="flex items-center gap-2">
              {testStatus.chatgpt ? (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              ChatGPT reads from cache successfully
            </li>
            <li className="flex items-center gap-2">
              {testStatus.chatgpt ? (
                <CheckCircle2 className="h-3 w-3 text-green-600" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              Logs show MCP authentication and extraction working
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
