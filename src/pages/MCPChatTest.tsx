import { MCPChat } from "@/components/MCPChat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw } from "lucide-react";

const MCP_BASE_URL = import.meta.env.VITE_MCP_BASE_URL || "https://signupassist-mcp-production.up.railway.app";

export default function MCPChatTest() {
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Fetch backend identity on mount
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
      
      // Handle Browserbase session limit error, if present
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

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold">SignupAssist — MCP Test Chat</h1>
          <div className="flex gap-2">
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
              variant="default"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingCache ? 'animate-spin' : ''}`} />
              {isRefreshingCache ? 'Refreshing...' : 'Refresh Cache'}
            </Button>
          </div>
        </div>
        
        <Card className="p-4 bg-green-500/10 border-green-500">
          <h3 className="text-xl font-semibold text-green-700 dark:text-green-400 mb-2">
            ✅ MCP Backend Connected
          </h3>
          <div className="space-y-1 text-sm">
            <p><strong>URL:</strong> {MCP_BASE_URL}</p>
            {backendInfo && (
              <>
                <p><strong>Backend:</strong> {backendInfo.backend}</p>
                <p><strong>Environment:</strong> {backendInfo.env}</p>
                <p><strong>Git Commit:</strong> {backendInfo.git_commit}</p>
                <p><strong>Timestamp:</strong> {backendInfo.timestamp}</p>
              </>
            )}
          </div>
        </Card>

        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline">Direct MCP Backend</Badge>
          <Badge variant="outline">No Local Simulation</Badge>
          <Badge variant="outline">Production Orchestrator</Badge>
        </div>
      </div>

      <Card className="p-6">
        <div className="mb-4 space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Quick Test Prompts:</h3>
          <div className="flex flex-wrap gap-2">
            <Badge 
              variant="outline" 
              className="cursor-pointer hover:bg-accent"
              onClick={() => {
                const input = document.querySelector('input[placeholder*="test"]') as HTMLInputElement;
                if (input) {
                  input.value = "I want to sign up my 8 year old for ski lessons";
                  input.focus();
                }
              }}
            >
              🎿 Ski lessons (8yo)
            </Badge>
            <Badge 
              variant="outline" 
              className="cursor-pointer hover:bg-accent"
              onClick={() => {
                const input = document.querySelector('input[placeholder*="test"]') as HTMLInputElement;
                if (input) {
                  input.value = "Find summer camps near me";
                  input.focus();
                }
              }}
            >
              ⛺ Summer camps
            </Badge>
            <Badge 
              variant="outline" 
              className="cursor-pointer hover:bg-accent"
              onClick={() => {
                const input = document.querySelector('input[placeholder*="test"]') as HTMLInputElement;
                if (input) {
                  input.value = "What programs are available at Blackhawk Ski Club?";
                  input.focus();
                }
              }}
            >
              🏔️ Blackhawk programs
            </Badge>
          </div>
        </div>
        <MCPChat />
      </Card>
    </div>
  );
}
