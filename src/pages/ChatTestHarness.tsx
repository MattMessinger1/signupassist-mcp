/**
 * ChatTestHarness Page
 * 
 * Production-ready chat interface for SignupAssist.
 * Developer tools are hidden behind a debug toggle.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { MessageList } from "@/components/chat-test/MessageList";
import { ChatInput } from "@/components/chat-test/ChatInput";
import { DebugPanel, LogEntry } from "@/components/chat-test/DebugPanel";

import { OAuthConnectDialog } from "@/components/OAuthConnectDialog";
import { SystemUserSetup } from "@/components/SystemUserSetup";
import type { ChatMessage } from "@/components/chat-test/MessageBubble";
import { checkMCPHealth, type MCPHealthCheckResult, callMCPTool } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
import { TestComparisonTracker, type CoverageReport, type TestResult } from "@/lib/testComparison";
import { validateTone, determineToneContext, formatToneIssues } from "@/lib/toneValidator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Shield, Bug } from "lucide-react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PROVIDER } from "@/lib/config/testHarness";

// ============= Types =============

interface ConversationState {
  sessionRef?: string;
  orgRef: string;
  selectedProgram?: any;
  childId?: string;
  registrationRef?: string;
  prerequisites?: any[];
  prerequisitesComplete?: boolean;
  availablePrograms?: any[];
  step?: string;
  category?: string;
  childAge?: number;
  aap?: any;
  ready_for_discovery?: boolean;
  feedQuery?: any;
  discoveryNotes?: string;
  bookingUserInfo?: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  pendingBookingAction?: {
    action: string;
    payload: any;
  };
}

// ============= Main Component =============

export default function ChatTestHarness() {
  const [mockAuthenticated, setMockAuthenticated] = useState(false);
  
  return (
    <ChatTestHarnessContent 
      mockAuthenticated={mockAuthenticated} 
      onToggleAuth={() => setMockAuthenticated(prev => !prev)} 
    />
  );
}

interface ChatTestHarnessContentProps {
  mockAuthenticated: boolean;
  onToggleAuth: () => void;
}

function ChatTestHarnessContent({ mockAuthenticated, onToggleAuth }: ChatTestHarnessContentProps) {
  const { session, isSessionValid } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Generate persistent session ID
  const [sessionId] = useState(() => `session-${Date.now()}-${Math.random().toString(36).substring(7)}`);

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ConversationState>({
    orgRef: DEFAULT_PROVIDER.defaultOrg,
  });
  const [mcpConnected, setMcpConnected] = useState(false);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [healthCheckResult, setHealthCheckResult] = useState<MCPHealthCheckResult | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [testTracker] = useState(() => new TestComparisonTracker());
  const [coverageReport, setCoverageReport] = useState<CoverageReport | null>(null);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginDialogData, setLoginDialogData] = useState<{
    provider: string;
    orgName: string;
    orgRef: string;
  } | null>(null);
  const [lastQuestionType, setLastQuestionType] = useState<'age' | 'category' | 'provider' | null>(null);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [showSystemUserSetup, setShowSystemUserSetup] = useState(false);

  // Mount guard
  const welcomeShownRef = useRef(false);

  // ============= Logging =============
  const addLog = useCallback((level: LogLevel, category: LogCategory, message: string, data?: any) => {
    const entry = createLogEntry(level, category, message, data);
    setDebugLogs(prev => [...prev, entry]);
  }, []);

  // Debug: Log AAP state updates
  useEffect(() => {
    console.log('[AAP State Update]', {
      provider: state.aap?.provider,
      activity: state.aap?.activity,
      age: state.aap?.age,
      ready_for_discovery: state.ready_for_discovery
    });
  }, [state.aap, state.ready_for_discovery]);

  // Get JWT helper
  const getUserJwt = (): string | undefined => {
    if (!session?.access_token) {
      console.warn('[Auth] No JWT available in session');
      return undefined;
    }
    
    if (!isSessionValid()) {
      console.error('[Auth] Session expired, JWT invalid');
      toast({
        title: "Session Expired",
        description: "Please log in again",
        variant: "destructive",
      });
      navigate('/auth');
      return undefined;
    }
    
    return session.access_token;
  };

  // ============= Geolocation Setup =============
  useEffect(() => {
    const fetchIPLocation = async () => {
      try {
        addLog("info", "system", "🌍 Detecting location from IP...");
        
        const { data, error } = await supabase.functions.invoke('get-user-location');
        
        if (error) {
          console.warn('[Location] IP geolocation failed:', error);
          addLog("warning", "system", "⚠️ Could not detect location - search will work without location bias");
          return;
        }
        
        if (data?.lat && data?.lng) {
          const coords = { lat: data.lat, lng: data.lng };
          setUserLocation(coords);
          
          const isMock = data.mock === true;
          const mockReasonMap: Record<string, string> = {
            "no_api_key": "IPAPI_KEY not configured",
            "localhost": "Development mode",
            "api_error": "API error - using fallback",
            "invalid_response": "Invalid response - using fallback",
            "error": "Error - using fallback"
          };
          const mockReason = mockReasonMap[data.reason as string] || "Using fallback";
          
          if (!isMock) {
            toast({
              title: "📍 Location Detected",
              description: `${data.city}, ${data.region} - Helps find nearby providers`,
            });
          }
          
          addLog(
            isMock ? "warning" : "success", 
            "system", 
            isMock 
              ? `🧪 Using mock location (${mockReason}): ${data.city}, ${data.region}`
              : `📍 Real location detected: ${data.city}, ${data.region}`,
            coords
          );
        }
      } catch (error) {
        console.warn('[Location] IP geolocation failed:', error);
        addLog("warning", "system", "⚠️ Location detection failed - search will work without location bias");
      }
    };
    
    fetchIPLocation();
  }, [addLog]);

  // ============= Initial Welcome Message =============
  useEffect(() => {
    setMessages(prev => {
      if (prev.length === 0) {
        const welcomeMessage: ChatMessage = {
          id: "welcome-1",
          sender: "assistant" as const,
          text: "Hi! I'm here to help you sign up for kids activities. What are you looking for today?",
          timestamp: new Date(),
        };
        return [welcomeMessage];
      }
      return prev;
    });
  }, [addLog]);

  // ============= Message Helpers =============

  const addUserMessage = (text: string) => {
    const newMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random()}`,
      sender: "user",
      text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    addLog("info", "user", `User message: ${text}`);
  };

  const addAssistantMessage = (
    text: string,
    componentType?: ChatMessage["componentType"],
    componentData?: any,
    stepName?: string
  ) => {
    const newMessage: ChatMessage = {
      id: `assistant-${Date.now()}-${Math.random()}`,
      sender: "assistant",
      text,
      timestamp: new Date(),
      componentType,
      componentData,
    };
    setMessages((prev) => [...prev, newMessage]);
    addLog(
      "info",
      "assistant",
      `Assistant message: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`,
      componentType ? { componentType, hasData: !!componentData } : undefined
    );
    
    const lowerText = text.toLowerCase();
    if (lowerText.includes("child's age") || lowerText.includes("childs age")) {
      setLastQuestionType('age');
    } else if (lowerText.includes('reset') || lowerText.includes('start over')) {
      setLastQuestionType(null);
    }
    
    // Tone validation
    const toneContext = determineToneContext(text, stepName);
    const toneValidation = validateTone(text, toneContext);
    
    if (toneValidation.issues.length > 0) {
      addLog("warning", "tone", "⚠️ Tone validation", {
        issues: toneValidation.issues,
        emojiCount: toneValidation.emojiCount,
        readingLevel: toneValidation.readingLevel.toFixed(1),
      });
    } else {
      addLog("success", "tone", "✅ Tone validation passed", {
        emojiCount: toneValidation.emojiCount,
        readingLevel: toneValidation.readingLevel.toFixed(1),
      });
    }
    
    if (componentData?.cards) {
      console.log('[HARNESS] 📦 Rendering cards:', componentData.cards.length);
    }
  };

  // ============= Error Handling =============

  const handleError = (error: string) => {
    addLog("error", "system", `Error occurred: ${error}`);
    console.error("[Chat Error]", error);
    toast({
      title: "Error",
      description: error,
      variant: "destructive",
    });
    addAssistantMessage(`Something went wrong. Please try again.`);
    setIsProcessing(false);
  };

  // ============= Action Handlers =============

  const handleCardAction = async (action: string, payload: any) => {
    console.log('[HARNESS] Card action triggered:', { action, payload });
    addLog("info", "user", `Card action: ${action}`, { payload });
    
    // Handle mandate recovery action
    if (action === "reconnect_login") {
      localStorage.removeItem('mandate_token');
      addLog("info", "system", "🔐 Initiating secure reconnection");
      
      setIsProcessing(true);
      try {
        const response = await sendAction('reconnect_login', {}, sessionId, getUserJwt());
        
        if (response.message) {
          addAssistantMessage(
            response.message,
            response.cards ? "cards" : undefined,
            { cards: response.cards, cta: response.cta }
          );
        }
        
        if (response.contextUpdates) {
          setState(prev => ({ ...prev, ...response.contextUpdates }));
        }
      } catch (error: any) {
        handleError(error.message);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    
    // Handle view_program action
    if (action === "postback" && payload?.intent === "view_program") {
      addLog("info", "system", "Fetching program details...", payload);
      
      try {
        const response = await sendAction(
          "view_program",
          {
            program_ref: payload.program_ref,
            org_ref: payload.org_ref
          },
          sessionId,
          getUserJwt()
        );
        
        if (response.message) {
          addAssistantMessage(
            response.message,
            response.cards ? "cards" : undefined,
            { cards: response.cards, cta: response.cta }
          );
        }
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to load program details",
          variant: "destructive"
        });
      }
      
      setIsProcessing(false);
      return;
    }
    
    // Handle login dialog
    if (action === "show_login_dialog" || action === "connect_account" || action === "show_credentials_card") {
      setLoginDialogData({
        provider: payload.provider || 'skiclubpro',
        orgName: payload.orgName || payload.orgRef || 'Provider',
        orgRef: payload.orgRef || 'unknown'
      });
      setShowLoginDialog(true);
      return;
    }
    
    // Handle Bookeo booking flow
    if (action === 'bookeo.create_hold') {
      if (!state.bookingUserInfo) {
        setState(prev => ({
          ...prev,
          pendingBookingAction: { action, payload }
        }));
        
        addAssistantMessage(
          "Great choice! To reserve your spot, I'll need a few details:\n\n" +
          "• Your first and last name\n" +
          "• Email address\n" +
          "• Number of adults and children\n\n" +
          "Please provide this information and I'll complete your reservation.",
          "form",
          {
            type: "user_info_collection",
            fields: [
              { id: "firstName", label: "First Name", type: "text", required: true },
              { id: "lastName", label: "Last Name", type: "text", required: true },
              { id: "email", label: "Email", type: "email", required: true },
              { id: "phone", label: "Phone (optional)", type: "tel", required: false },
            ]
          }
        );
        return;
      }
    }
    
    // Generic action handling
    setIsProcessing(true);
    
    try {
      const response = await sendAction(action, payload, sessionId, getUserJwt());
      
      if (response.message) {
        addAssistantMessage(
          response.message,
          response.cards ? "cards" : undefined,
          { cards: response.cards, cta: response.cta }
        );
      }
      
      if (response.contextUpdates) {
        setState(prev => ({ ...prev, ...response.contextUpdates }));
      }
    } catch (error: any) {
      handleError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ============= Send Message =============

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;
    
    const userInput = input.trim();
    setInput("");
    addUserMessage(userInput);
    setIsProcessing(true);
    
    try {
      const response = await sendMessage(
        userInput, 
        sessionId, 
        userLocation || undefined, 
        getUserJwt(),
        state.aap,
        state.category,
        state.childAge
      );
      
      if (response.message) {
        addAssistantMessage(
          response.message,
          response.cards ? "cards" : undefined,
          { cards: response.cards, cta: response.cta }
        );
      }
      
      if (response.contextUpdates) {
        setState(prev => ({ ...prev, ...response.contextUpdates }));
      }
    } catch (error: any) {
      handleError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ============= Reset Handler =============

  const handleReset = () => {
    setMessages([]);
    setState({ orgRef: DEFAULT_PROVIDER.defaultOrg });
    setDebugLogs([]);
    setLastQuestionType(null);
    welcomeShownRef.current = false;
    
    // Re-add welcome message
    const welcomeMessage: ChatMessage = {
      id: "welcome-1",
      sender: "assistant" as const,
      text: "Hi! I'm here to help you sign up for kids activities. What are you looking for today?",
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
    
    toast({
      title: "Chat Reset",
      description: "Starting fresh conversation",
    });
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Clean Header */}
      <header className="border-b bg-card px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-primary">SignupAssist</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleReset}
            >
              New Chat
            </Button>
            
            {/* Developer Tools Toggle */}
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-muted-foreground"
              onClick={() => setShowDebugPanel(prev => !prev)}
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      
      {/* Debug Panel (Collapsible) */}
      <DebugPanel 
        logs={debugLogs}
        isVisible={showDebugPanel}
        onToggle={() => setShowDebugPanel(prev => !prev)}
        onClear={() => setDebugLogs([])}
      />

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <MessageList 
            messages={messages} 
            onAction={handleCardAction}
            isProcessing={isProcessing}
            mcpConnected={mcpConnected}
          />
        </div>
      </div>

      {/* Chat Input */}
      <div className="border-t bg-card px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={isProcessing}
            placeholder="Type a message... (e.g., 'Find ski lessons for my 8 year old')"
          />
          <p className="text-xs text-muted-foreground text-center mt-2">
            SignupAssist • Your responsible registration delegate
          </p>
        </div>
      </div>

      {/* Dialogs */}
      {loginDialogData && (
        <OAuthConnectDialog
          open={showLoginDialog}
          onOpenChange={setShowLoginDialog}
          provider={loginDialogData.provider}
          orgName={loginDialogData.orgName}
          orgRef={loginDialogData.orgRef}
          onSuccess={() => {
            setShowLoginDialog(false);
            toast({
              title: "Connected",
              description: `Successfully connected to ${loginDialogData.orgName}`,
            });
          }}
        />
      )}

      <Dialog open={showSystemUserSetup} onOpenChange={setShowSystemUserSetup}>
        <DialogContent className="max-w-md">
          <SystemUserSetup />
        </DialogContent>
      </Dialog>
    </div>
  );
}
