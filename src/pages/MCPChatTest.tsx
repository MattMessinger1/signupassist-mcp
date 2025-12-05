import { MCPChat } from "@/components/MCPChat";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw } from "lucide-react";
import { DeploymentStatusMonitor } from "@/components/DeploymentStatusMonitor";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { AppActivationGate } from "@/components/AppActivationGate";
import { User, Session } from "@supabase/supabase-js";

// Initialize Stripe
const stripePromise = loadStripe("pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx");

const MCP_BASE_URL = import.meta.env.VITE_MCP_BASE_URL || "https://signupassist-mcp-production.up.railway.app";

type AppState = 'gate' | 'authenticating' | 'denied' | 'active';

export default function MCPChatTest() {
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [isSyncingBookeo, setIsSyncingBookeo] = useState(false);
  const [appState, setAppState] = useState<AppState>('gate');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const { toast } = useToast();

  // Check existing auth on mount and listen for auth changes
  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('[MCPChatTest] Auth state changed:', event, session?.user?.id);
        setSession(session);
        setUser(session?.user ?? null);
        
        // If user signed in while authenticating, transition to active
        if (event === 'SIGNED_IN' && appState === 'authenticating') {
          console.log('[MCPChatTest] User signed in - activating app');
          setAppState('active');
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[MCPChatTest] Existing session:', session?.user?.id);
      setSession(session);
      setUser(session?.user ?? null);
      
      // If already authenticated, skip directly to active
      if (session?.user) {
        console.log('[MCPChatTest] Already authenticated - skipping to active');
        setAppState('active');
      }
    });

    return () => subscription.unsubscribe();
  }, [appState]);

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
    setAppState('gate');
    toast({
      title: "Signed Out",
      description: "You've been signed out. Refresh to test the full activation flow.",
    });
  };

  // Show activation gate for unauthenticated users
  if (appState !== 'active') {
    return (
      <div className="container mx-auto p-8 max-w-4xl">
        <div className="mb-8 space-y-4">
          <h1 className="text-4xl font-bold text-center">ChatGPT App Store Simulation</h1>
          <p className="text-center text-muted-foreground">
            This simulates the permission flow users see when enabling a ChatGPT App
          </p>
        </div>
        
        <AppActivationGate
          appName="SignupAssist"
          onAllow={() => setAppState('authenticating')}
          onDeny={() => setAppState('denied')}
          isAuthenticating={appState === 'authenticating'}
          onAuthSuccess={() => setAppState('active')}
        />
        
        <div className="mt-8 text-center text-xs text-muted-foreground">
          <p>In the real ChatGPT App Store:</p>
          <p>• Users click "Allow" → OAuth redirect to Auth0 → Return authenticated</p>
          <p>• All subsequent interactions are authenticated</p>
        </div>
      </div>
    );
  }

  // Active state - show full chat interface
  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold">SignupAssist — MCP Test Chat</h1>
            <Badge variant="default" className="bg-green-600">
              ✅ App Enabled
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={handleSignOut}
              variant="outline"
              size="sm"
            >
              🔓 Sign Out
            </Button>
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
        
        {/* Auth Status Card - Shows authenticated user */}
        <Card className="p-3 bg-green-500/10 border-green-500">
          <p className="text-sm text-green-700 dark:text-green-400">
            <strong>🔐 Authenticated as:</strong> {user?.email} (ID: {user?.id?.slice(0, 8)}...)
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            In ChatGPT App Store, all interactions after "Allow" are authenticated via OAuth.
          </p>
        </Card>
        
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
              <strong>Auth-First Mode:</strong> All interactions are now authenticated (like real ChatGPT App Store).
              Click "Sign Out" to test the full activation flow again.
            </p>
          </div>
        </Card>
      </div>

      <Elements stripe={stripePromise}>
        <MCPChat 
          authenticatedUser={user}
          requireAuth={true}
        />
      </Elements>
    </div>
  );
}
