import { MCPChat } from "@/components/MCPChat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Sparkles } from "lucide-react";
import { DeploymentStatusMonitor } from "@/components/DeploymentStatusMonitor";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { User, Session } from "@supabase/supabase-js";

// Initialize Stripe
const stripePromise = loadStripe("pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx");

const MCP_BASE_URL = import.meta.env.VITE_MCP_BASE_URL || "https://signupassist-mcp-production.up.railway.app";

export default function MCPChatTest() {
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [isSyncingBookeo, setIsSyncingBookeo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [mockAuthenticated, setMockAuthenticated] = useState(false);
  const { toast } = useToast();

  // Check existing auth on mount and listen for auth changes
  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('[MCPChatTest] Auth state changed:', event, session?.user?.id);
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[MCPChatTest] Existing session:', session?.user?.id);
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
        description: `${data.synced || 0} programs synced for ${orgRef}`,
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Signed Out",
      description: "You've been signed out successfully.",
    });
  };

  // ChatGPT SDK-accurate: No blocking gate. Chat is immediately active.
  // Auth is triggered inline when tools require it (lazy auth at payment step).
  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold">SignupAssist</h1>
            {/* ChatGPT-style app indicator badge */}
            <Badge variant="secondary" className="flex items-center gap-1 bg-primary/10 text-primary border-primary/20">
              <Sparkles className="w-3 h-3" />
              Used SignupAssist
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => setMockAuthenticated(prev => !prev)}
              variant={mockAuthenticated ? "default" : "outline"}
              size="sm"
            >
              {mockAuthenticated ? "🔓 Authenticated" : "🔒 Unauthenticated"}
            </Button>
            {user && (
              <Button
                onClick={handleSignOut}
                variant="outline"
                size="sm"
              >
                Sign Out
              </Button>
            )}
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
        </div>
        
        {/* Auth Status - Shows as inline indicator (like ChatGPT's "Auth complete" message) */}
        {user ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            Signed in as {user.email}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            Browsing anonymously • Sign in required for bookings
          </div>
        )}
        
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
                <div><strong>Endpoint:</strong> <Badge variant="secondary">{MCP_BASE_URL}</Badge></div>
              </>
            ) : (
              <p className="text-muted-foreground">Fetching backend info...</p>
            )}
          </div>
        </Card>

        <Card className="p-4 bg-blue-500/10 border-blue-500">
          <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-400 mb-2">
            🧪 Discovery Confidence Test Prompts
          </h3>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-green-600 dark:text-green-400">HIGH Confidence (→ Direct activation):</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                <li>"Sign up my kid for AIM Design in Madison"</li>
                <li>"bookeo.com/aimdesign"</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-yellow-600 dark:text-yellow-400">MEDIUM Confidence (→ Clarification card):</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                <li>"Classes at AIM Design"</li>
                <li>"AIM Design courses for kids"</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-red-600 dark:text-red-400">LOW Confidence (→ Decline gracefully):</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                <li>"AIM Design is cool"</li>
                <li>"I want to enroll in a class"</li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
              <strong>ChatGPT SDK Mode:</strong> Anonymous browsing allowed. Auth triggered inline at payment step.
            </p>
          </div>
        </Card>
      </div>

      <Elements stripe={stripePromise}>
        <MCPChat 
          authenticatedUser={mockAuthenticated 
            ? { id: '00000000-0000-0000-0000-000000000001', email: 'test@example.com' } 
            : null  // Force unauthenticated when mock is off
          }
          forceUnauthenticated={!mockAuthenticated}
          requireAuth={false}  // Allow anonymous browsing, lazy auth at payment
        />
      </Elements>
    </div>
  );
}
