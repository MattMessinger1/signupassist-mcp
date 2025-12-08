import { MCPChat } from "@/components/MCPChat";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Shield, Bug, LogOut, ChevronDown, ChevronUp } from "lucide-react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { User, Session } from "@supabase/supabase-js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Initialize Stripe
const stripePromise = loadStripe("pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx");

const MCP_BASE_URL = import.meta.env.VITE_MCP_BASE_URL || "https://signupassist-mcp-production.up.railway.app";

export default function MCPChatTest() {
  const [backendInfo, setBackendInfo] = useState<any>(null);
  const [isSyncingBookeo, setIsSyncingBookeo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [showDevTools, setShowDevTools] = useState(false);
  const { toast } = useToast();

  // Check existing auth on mount and listen for auth changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('[MCPChatTest] Auth state changed:', event, session?.user?.id);
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

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

  const handleSyncBookeo = async (orgRef: string) => {
    setIsSyncingBookeo(true);
    console.log(`[Bookeo Sync] Starting sync for ${orgRef}...`);

    try {
      const { data, error } = await supabase.functions.invoke('sync-bookeo', {
        body: { org_ref: orgRef }
      });

      if (error) throw error;

      toast({
        title: "Programs Synced",
        description: `${data.synced || 0} programs synced for ${orgRef}`,
      });
    } catch (error: any) {
      console.error('[Bookeo Sync] Error:', error);
      toast({
        title: "Sync Failed",
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

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Clean Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-primary">SignupAssist</h1>
              <p className="text-xs text-muted-foreground">Responsible Registration</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.email}
                </span>
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </Button>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2"></span>
                Browsing anonymously
              </span>
            )}
            
            {/* Dev Tools Toggle */}
            <Button 
              variant="ghost" 
              size="icon"
              className="text-muted-foreground"
              onClick={() => setShowDevTools(prev => !prev)}
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Dev Tools Panel (Hidden by Default) */}
      <Collapsible open={showDevTools}>
        <CollapsibleContent>
          <div className="border-b bg-muted/30 px-4 py-3">
            <div className="max-w-4xl mx-auto space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Developer Tools</span>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleSyncBookeo('aim-design')}
                    disabled={isSyncingBookeo}
                    variant="outline"
                    size="sm"
                  >
                    {isSyncingBookeo ? 'Syncing...' : 'Sync AIM Design'}
                  </Button>
                </div>
              </div>
              
              {backendInfo && (
                <div className="text-xs text-muted-foreground flex items-center gap-4">
                  <span>Server: {backendInfo.backend}</span>
                  <span>Version: {backendInfo.git_commit?.substring(0, 7)}</span>
                  <span className="text-green-600">● Connected</span>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-hidden">
        <Elements stripe={stripePromise}>
          <MCPChat 
            authenticatedUser={user 
              ? { id: user.id, email: user.email || undefined } 
              : null
            }
            forceUnauthenticated={!user}
            requireAuth={false}
          />
        </Elements>
      </div>

      {/* Footer */}
      <div className="border-t bg-card px-4 py-2">
        <p className="text-xs text-muted-foreground text-center">
          SignupAssist • Your responsible registration delegate • All actions are logged and auditable
        </p>
      </div>
    </div>
  );
}
