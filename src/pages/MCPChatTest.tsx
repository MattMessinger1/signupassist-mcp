import { MCPChat } from "@/components/MCPChat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw } from "lucide-react";
import { DeploymentStatusMonitor } from "@/components/DeploymentStatusMonitor";

const MCP_BASE_URL = import.meta.env.VITE_MCP_BASE_URL || "https://signupassist-mcp-production.up.railway.app";

export default function MCPChatTest() {
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [isSyncingBookeo, setIsSyncingBookeo] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch(`${MCP_BASE_URL}/identity`)
      .then(res => res.json())
      .then(data => setBackendInfo(data))
      .catch(err => console.error("Failed to fetch backend identity:", err));
  }, []);

  const handleRefreshCache = async () => {
    setIsRefreshingCache(true);
    console.log('[Cache Refresh] Starting...');

    try {
      const { data, error } = await supabase.functions.invoke('refresh-feed');

      if (error) {
        throw error;
      }

      console.log('[Cache Refresh] Success:', data);
      
      if (data?.error && typeof data.error === 'string' && data.error.includes('session limit')) {
        toast({
          title: "⚠️ Session Limit Reached",
          description: "Browserbase sessions at capacity. Please cleanup sessions and retry.",
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: "✅ Cache Refreshed",
        description: `${data.refreshed || 0} programs refreshed`,
      });

    } catch (error: any) {
      console.error('[Cache Refresh] Error:', error);
      
      toast({
        title: "❌ Cache Refresh Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsRefreshingCache(false);
    }
  };

  const handleCleanupSessions = async () => {
    console.log('[Session Cleanup] Starting...');
    
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-browserbase-sessions');
      
      if (error) {
        throw error;
      }
      
      console.log('[Session Cleanup] Success:', data);
      toast({
        title: "✅ Sessions Cleaned",
        description: `Terminated ${data.terminated || 0} active sessions`,
      });
    } catch (error: any) {
      console.error('[Session Cleanup] Error:', error);
      toast({
        title: "❌ Cleanup Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const handleSyncBookeo = async (orgRef: string) => {
    setIsSyncingBookeo(true);
    console.log(`[Bookeo Sync] Starting sync for ${orgRef}...`);

    try {
      const { data, error } = await supabase.functions.invoke('sync-bookeo', {
        body: { org_ref: orgRef }
      });

      if (error) {
        throw error;
      }

      console.log('[Bookeo Sync] Success:', data);
      toast({
        title: "✅ Bookeo Synced",
        description: `${data.synced || 0} programs synced for ${data.org_ref}`,
      });

    } catch (error: any) {
      console.error('[Bookeo Sync] Error:', error);
      toast({
        title: "❌ Sync Failed",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSyncingBookeo(false);
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold">SignupAssist — MCP Test Chat</h1>
          <div className="flex gap-2">
            <Button
              onClick={() => handleSyncBookeo('aim-design')}
              disabled={isSyncingBookeo}
              variant="default"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isSyncingBookeo ? 'animate-spin' : ''}`} />
              {isSyncingBookeo ? 'Syncing...' : 'Sync AIM Design'}
            </Button>
            <Button
              onClick={handleCleanupSessions}
              variant="outline"
              size="sm"
            >
              Cleanup Sessions
            </Button>
            <Button
              onClick={handleRefreshCache}
              disabled={isRefreshingCache}
              variant="secondary"
              size="sm"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingCache ? 'animate-spin' : ''}`} />
              {isRefreshingCache ? 'Refreshing...' : 'Refresh Cache'}
            </Button>
          </div>
        </div>
        
        <DeploymentStatusMonitor />
        
        <Card className="p-4 bg-green-500/10 border-green-500">
          <h3 className="text-xl font-semibold text-green-700 dark:text-green-400 mb-2">
            ✅ MCP Backend Connected
          </h3>
          <div className="space-y-1 text-sm">
            {backendInfo ? (
              <>
                <p><strong>Server:</strong> {backendInfo.backend || 'Unknown'}</p>
                <p><strong>Environment:</strong> {backendInfo.env || 'Unknown'}</p>
                <p><strong>Version:</strong> {backendInfo.git_commit?.substring(0, 7) || 'Unknown'}</p>
                <p><strong>Endpoint:</strong> <Badge variant="secondary">{MCP_BASE_URL}</Badge></p>
              </>
            ) : (
              <p className="text-muted-foreground">Fetching backend info...</p>
            )}
          </div>
        </Card>

        <Card className="p-4 bg-blue-500/10 border-blue-500">
          <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-400 mb-2">
            🧪 Quick Test Prompts
          </h3>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Try these prompts in the chat below:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>"I'd like to sign up for courses from AIM Design"</li>
              <li>"Show me STEM Robotics at AIM Design for my 9 year old"</li>
              <li>"Find ski jumping classes for kids in Madison"</li>
            </ul>
          </div>
        </Card>
      </div>

      <MCPChat />
    </div>
  );
}
