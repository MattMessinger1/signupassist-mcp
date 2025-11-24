/**
 * ChatTestHarness Page
 * 
 * A comprehensive test environment for SignupAssist that simulates ChatGPT-style interactions.
 * 
 * Features:
 * - Real MCP backend integration
 * - Interactive chat UI with message components
 * - Automated demo flow for testing
 * - Debug logging panel
 * - Modular, extensible architecture
 * 
 * Usage:
 * - Type messages to interact manually
 * - Click "Run Demo Flow" to execute automated test sequence
 * - Click "Reset" to clear conversation and start fresh
 * - Toggle debug panel to see detailed logs
 * 
 * Architecture:
 * - Uses centralized config from lib/config/testHarness.ts
 * - Flow orchestration in lib/chatFlowOrchestrator.ts
 * - Response parsing in lib/chatResponseParser.ts
 * - Modular UI components in components/chat-test/
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { HarnessHeader } from "@/components/chat-test/HarnessHeader";
import { MessageList } from "@/components/chat-test/MessageList";
import { ChatInput } from "@/components/chat-test/ChatInput";
import { DebugPanel, LogEntry } from "@/components/chat-test/DebugPanel";
import { TestCoveragePanel } from "@/components/chat-test/TestCoveragePanel";

import { LoginCredentialDialog } from "@/components/LoginCredentialDialog";
import { SystemUserSetup } from "@/components/SystemUserSetup";
import type { ChatMessage } from "@/components/chat-test/MessageBubble";
import { checkMCPHealth, type MCPHealthCheckResult, callMCPTool } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
import { TestComparisonTracker, type CoverageReport, type TestResult } from "@/lib/testComparison";
import { validateTone, determineToneContext, formatToneIssues } from "@/lib/toneValidator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import { sendMessage, sendAction, overridePrompt } from "@/lib/orchestratorClient";
import { parseIntent } from "@/lib/intentParser";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_PROVIDER,
  TEST_SCENARIOS,
} from "@/lib/config/testHarness";
import { PRODUCTION_SYSTEM_PROMPT } from "@/lib/prompts";

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
  step?: string; // Current flow step
  category?: string; // Activity category from intent (legacy)
  childAge?: number; // Child age from intent (legacy)
  
  // NEW: Phase 3 - Structured AAP Object
  aap?: any;  // Structured AAP from backend
  ready_for_discovery?: boolean;
  feedQuery?: any;
  discoveryNotes?: string;
  
  // Bookeo booking flow
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
  // Debug: Add console log to verify component mounts
  console.log('[ChatTestHarness] Component mounting');
  
  // Auth
  const { user, session, loading, isSessionValid } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Debug: Log auth state
  useEffect(() => {
    console.log('[ChatTestHarness] Auth state:', { user: !!user, session: !!session, loading });
  }, [user, session, loading]);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      console.log('[ChatTestHarness] Redirecting to auth - no user');
      toast({
        title: "Authentication Required",
        description: "Please log in to use the Chat Test Harness",
        variant: "destructive",
      });
      navigate('/auth');
    }
  }, [user, loading, navigate, toast]);

  // Show loading state while checking auth
  if (loading) {
    console.log('[ChatTestHarness] Rendering loading state');
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user || !session) {
    console.log('[ChatTestHarness] Not rendering - no user or session');
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-foreground">Redirecting...</p>
      </div>
    );
  }

  console.log('[ChatTestHarness] Rendering main content');
  return <ChatTestHarnessContent />;
}

function ChatTestHarnessContent() {
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
  const [showDebugPanel, setShowDebugPanel] = useState(false); // Start collapsed for more space
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

  // Mount guard to prevent duplicate initialization
  const welcomeShownRef = useRef(false);

  // ============= Logging =============
  // Define addLog early with useCallback for stable reference
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
    
    // Validate session is not expired
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
          
          // Different messages for mock vs real location
          const isMock = data.mock === true;
          const mockReasonMap: Record<string, string> = {
            "no_api_key": "IPAPI_KEY not configured",
            "localhost": "Development mode",
            "api_error": "API error - using fallback",
            "invalid_response": "Invalid response - using fallback",
            "error": "Error - using fallback"
          };
          const mockReason = mockReasonMap[data.reason as string] || "Using fallback";
          
          // Only show toast for real location detection (mock is just dev noise)
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
    // Add welcome message only if messages array is empty
    setMessages(prev => {
      if (prev.length === 0) {
        const welcomeMessage: ChatMessage = {
          id: "welcome-1",
          sender: "assistant" as const,
          text: "Hello! I can assist you with program sign-ups. How can I help today?",
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
    
    // Track when assistant asks about age for context-aware parsing
    const lowerText = text.toLowerCase();
    if (lowerText.includes("child's age") || lowerText.includes("childs age")) {
      setLastQuestionType('age');
      console.log('[HARNESS] Context: Last question was about AGE');
    } else if (lowerText.includes('reset') || lowerText.includes('start over')) {
      setLastQuestionType(null);
    }
    
    // Tone validation (Design DNA compliance check)
    const toneContext = determineToneContext(text, stepName);
    const toneValidation = validateTone(text, toneContext);
    
    if (toneValidation.issues.length > 0) {
      addLog("warning", "tone", "⚠️ Tone validation", {
        issues: toneValidation.issues,
        emojiCount: toneValidation.emojiCount,
        readingLevel: toneValidation.readingLevel.toFixed(1),
      });
      
      // Log individual issues for visibility
      toneValidation.issues.forEach(issue => {
        console.warn('[Tone Validator]', issue);
      });
    } else {
      addLog("success", "tone", "✅ Tone validation passed", {
        emojiCount: toneValidation.emojiCount,
        readingLevel: toneValidation.readingLevel.toFixed(1),
      });
    }
    
    // Enhanced logging for cards
    if (componentData?.cards) {
      console.log('[HARNESS] 📦 Rendering cards:', componentData.cards.length);
      componentData.cards.forEach((card: any, idx: number) => {
        console.log(`[HARNESS]   Card ${idx + 1}: ${card.title}`);
        if (card.buttons) {
          console.log(`[HARNESS]     Buttons: ${card.buttons.map((b: any) => b.label).join(", ")}`);
        }
      });
    }
    
    // Enhanced logging for CTAs
    if (componentData?.cta) {
      console.log('[HARNESS] 🎯 CTAs:', componentData.cta.map((c: any) => c.label).join(", "));
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
    addAssistantMessage(`❌ Error: ${error}`);
    setIsProcessing(false);
  };

  // ============= Action Handlers =============

  /**
   * Handle card action clicks (Context-Aware Action Handler)
   * Routes card button clicks to orchestrator backend
   */
  const handleCardAction = async (action: string, payload: any) => {
    console.log(`[HARNESS] Card action triggered: ${action}`, payload);
    addLog("info", "user", `Card action: ${action}`, { payload });
    
    // Handle mandate recovery action
    if (action === "reconnect_login") {
      console.log('[ChatTest] Triggering secure reconnection flow');
      
      // Clear stored mandate from frontend if any
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
    
    // Quick Win #5: Handle view_program action - call scp.program_field_probe
    if (action === "postback" && payload?.intent === "view_program") {
      console.log('[HARNESS] View program details:', payload);
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
        
        // Add assistant response with program details
        if (response.message) {
          addAssistantMessage(
            response.message,
            response.cards ? "cards" : undefined,
            { cards: response.cards, cta: response.cta }
          );
        }
        
        // Log any cards returned (form fields, etc.)
        if (response.cards && response.cards.length > 0) {
          addLog("info", "system", `Loaded ${response.cards.length} detail cards`);
        }
      } catch (error: any) {
        console.error('[HARNESS] Failed to load program details:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to load program details",
          variant: "destructive"
        });
      }
      
      setIsProcessing(false);
      return;
    }
    
    // Handle special actions that need UI dialogs
    if (action === "show_login_dialog" || action === "connect_account" || action === "show_credentials_card") {
      console.log('[HARNESS] Opening login dialog with payload:', payload);
      setLoginDialogData({
        provider: payload.provider || 'skiclubpro',
        orgName: payload.orgName || payload.orgRef || 'Provider',
        orgRef: payload.orgRef || 'unknown'
      });
      setShowLoginDialog(true);
      return;
    }
    
    // Handle Bookeo booking flow - collect user info if needed
    if (action === 'bookeo.create_hold') {
      // Check if we have user info
      if (!state.bookingUserInfo) {
        // Store the pending action and ask for user info
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
              { id: "adults", label: "Number of Adults", type: "number", required: true, min: 1 },
              { id: "children", label: "Number of Children", type: "number", required: true, min: 0 }
            ],
            submitAction: "submit_booking_info"
          }
        );
        return;
      }
      
      // We have user info, proceed with creating hold
      setIsProcessing(true);
      addLog("info", "mcp", `Creating booking hold with user info`, payload);
      
      try {
        const result = await callMCPTool('bookeo.create_hold', {
          ...payload,
          firstName: state.bookingUserInfo.firstName,
          lastName: state.bookingUserInfo.lastName,
          email: state.bookingUserInfo.email,
          phone: state.bookingUserInfo.phone,
          adults: payload.adults || 1,
          children: payload.children || 0
        });
        
        addLog("success", "mcp", `Hold created`, result);
        
        if (result?.ui?.cards && result.ui.cards.length > 0) {
          const card = result.ui.cards[0];
          addAssistantMessage(
            "Perfect! Here's your reservation summary:",
            card.componentType,
            card.componentData || card,
            state.step
          );
        } else {
          handleError(result?.error ? String(result.error) : "Failed to create hold");
        }
      } catch (error: any) {
        console.error('[HARNESS] Create hold error:', error);
        addLog("error", "mcp", `Create hold failed`, error.message);
        handleError(error.message);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    
    // Handle user info submission
    if (action === 'submit_booking_info') {
      const { firstName, lastName, email, phone, adults, children } = payload;
      
      // Validate required fields
      if (!firstName || !lastName || !email || adults === undefined || children === undefined) {
        addAssistantMessage("Please fill in all required fields (first name, last name, email, number of adults and children).");
        return;
      }
      
      // Store user info in state
      setState(prev => ({
        ...prev,
        bookingUserInfo: { firstName, lastName, email, phone }
      }));
      
      addLog("info", "system", "User info collected", { firstName, lastName, email });
      
      // If we have a pending booking action, execute it now
      if (state.pendingBookingAction) {
        const pendingAction = state.pendingBookingAction;
        
        // Clear the pending action
        setState(prev => ({
          ...prev,
          pendingBookingAction: undefined
        }));
        
        // Call create_hold with complete data
        setIsProcessing(true);
        addLog("info", "mcp", `Creating hold with collected info`, pendingAction.payload);
        
        try {
          const result = await callMCPTool('bookeo.create_hold', {
            ...pendingAction.payload,
            firstName,
            lastName,
            email,
            phone,
            adults: parseInt(adults),
            children: parseInt(children)
          });
          
          addLog("success", "mcp", `Hold created`, result);
          
          if (result?.ui?.cards && result.ui.cards.length > 0) {
            const card = result.ui.cards[0];
            addAssistantMessage(
              "Perfect! Here's your reservation summary:",
              card.componentType,
              card.componentData || card,
              state.step
            );
          } else {
            handleError(result?.error ? String(result.error) : "Failed to create hold");
          }
        } catch (error: any) {
          console.error('[HARNESS] Create hold error:', error);
          addLog("error", "mcp", `Create hold failed`, error.message);
          handleError(error.message);
        } finally {
          setIsProcessing(false);
        }
      } else {
        addAssistantMessage("Thanks! Your information has been saved. You can now proceed with booking.");
      }
      return;
    }
    
    // Handle booking confirmation
    if (action === 'bookeo.confirm_booking') {
      setIsProcessing(true);
      addLog("info", "mcp", `Confirming booking`, payload);
      
      try {
        const result = await callMCPTool('bookeo.confirm_booking', payload);
        addLog("success", "mcp", `Booking confirmed`, result);
        
        if (result?.ui?.cards && result.ui.cards.length > 0) {
          const card = result.ui.cards[0];
          addAssistantMessage(
            "",
            card.componentType,
            card.componentData || card,
            state.step
          );
        } else if (result?.success) {
          const successMessage = typeof result.data === 'string' 
            ? result.data 
            : result.data?.message || "Booking confirmed successfully!";
          addAssistantMessage(successMessage);
        } else {
          handleError(result?.error ? String(result.error) : "Failed to confirm booking");
        }
      } catch (error: any) {
        console.error('[HARNESS] Confirm booking error:', error);
        addLog("error", "mcp", `Confirm booking failed`, error.message);
        handleError(error.message);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    
    // Handle cancel action
    if (action === 'cancel') {
      addAssistantMessage("No problem! Let me know if you'd like to explore other options.");
      // Clear pending booking action if any
      setState(prev => ({
        ...prev,
        pendingBookingAction: undefined
      }));
      return;
    }
    
    // Handle other Bookeo tools
    if (action.startsWith('bookeo.')) {
      setIsProcessing(true);
      addLog("info", "mcp", `Calling tool: ${action}`, payload);
      
      try {
        const result = await callMCPTool(action, payload);
        addLog("success", "mcp", `Tool ${action} completed`, result);
        
        if (result?.ui?.cards && result.ui.cards.length > 0) {
          const card = result.ui.cards[0];
          const message = result.data?.message || "Here's what I found:";
          
          addAssistantMessage(
            message,
            card.componentType,
            card.componentData || card,
            state.step
          );
        } else if (result?.success) {
          const successMessage = typeof result.data === 'string' 
            ? result.data 
            : result.data?.message || "Action completed successfully!";
          addAssistantMessage(successMessage);
        } else {
          handleError(result?.error ? String(result.error) : "An error occurred");
        }
      } catch (error: any) {
        console.error('[HARNESS] Tool call error:', error);
        addLog("error", "mcp", `Tool ${action} failed`, error.message);
        handleError(error.message);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    
    setIsProcessing(true);

    try {
      // Call orchestrator's handleAction
      const response = await sendAction(action, payload, sessionId, getUserJwt());
      
      console.log('[HARNESS] Action response:', response);
      console.log('[FLOW]', action, '→', response.cards ? `${response.cards.length} cards` : 'no cards');
      
      // Detect if response contains form metadata and render as form
      if (response.metadata?.signupForm) {
        console.log('[HARNESS] Detected signup form in metadata, rendering as form component');
        addAssistantMessage(
          response.message,
          "form",
          {
            fields: response.metadata.signupForm.fields,
            submitAction: "submit_form",
            title: "Registration Form"
          },
          response.contextUpdates?.step || state.step
        );
      } else {
        // Render next assistant message with cards (with tone validation context)
        addAssistantMessage(
          response.message,
          response.cards ? "cards" : undefined,
          { cards: response.cards, cta: response.cta },
          response.contextUpdates?.step || state.step
        );
      }
      
      // Update local state
      if (response.contextUpdates) {
        setState(prev => ({ ...prev, ...response.contextUpdates }));
      }
    } catch (error: any) {
      console.error('[HARNESS] Action handler error:', error);
      handleError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ============= Flow Handlers =============

  /**
   * Handle sending a message - Auto-detects comprehensive test requests
   * Routes user input through the orchestrator backend OR triggers full test
   */
  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    setInput("");
    addUserMessage(userInput);
    
    console.log('[HARNESS] ===== USER INPUT =====');
    console.log('[HARNESS] Input:', userInput);

    // Auto-detect comprehensive test request
    const lowerInput = userInput.toLowerCase();
    
    // Handle /tonepatch command for inline tone training
    if (userInput.startsWith('/tonepatch ')) {
      const newPrompt = userInput.replace('/tonepatch ', '').trim();
      
      if (newPrompt === 'reset') {
        try {
          await overridePrompt(sessionId, PRODUCTION_SYSTEM_PROMPT);
          addLog('info', 'tone', 'Tone Reset', `✅ Prompt reset to production version for session ${sessionId}`);
          addAssistantMessage('✅ Prompt reset to production version.');
        } catch (error: any) {
          addLog('error', 'tone', 'Tone Reset Failed', `❌ Error: ${error.message}`);
          addAssistantMessage(`❌ Failed to reset prompt: ${error.message}`);
        }
        setIsProcessing(false);
        return;
      }
      
      if (!newPrompt) {
        addAssistantMessage("❌ Please provide a prompt to apply. Example: `/tonepatch Make success messages more celebratory`");
        setIsProcessing(false);
        return;
      }
      
      try {
        await overridePrompt(sessionId, newPrompt);
        addLog('info', 'tone', 'Tone Override', `✅ Applied custom prompt: "${newPrompt.substring(0, 50)}..."`);
        addAssistantMessage(`✅ Tone override applied. New prompt active for this session. Type "/tonepatch reset" to revert.`);
      } catch (error: any) {
        addLog('error', 'tone', 'Tone Override Failed', `❌ Error: ${error.message}`);
        addAssistantMessage(`❌ Failed to apply custom prompt: ${error.message}`);
      }
      
      setIsProcessing(false);
      return;
    }
    
    if (userInput === '/tonepatch reset') {
      try {
        await overridePrompt(sessionId, PRODUCTION_SYSTEM_PROMPT);
        addLog('info', 'tone', 'Tone Reset', '✅ Reverted to production prompt');
        addAssistantMessage('✅ Prompt reset to production version.');
      } catch (error: any) {
        addLog('error', 'tone', 'Tone Reset Failed', `❌ Error: ${error.message}`);
        addAssistantMessage(`❌ Failed to reset prompt: ${error.message}`);
      }
      setIsProcessing(false);
      return;
    }
    
    if (lowerInput.includes('run full test') ||
        lowerInput.includes('test everything') ||
        lowerInput.includes('comprehensive test')) {
      await runComprehensiveTests();
      return;
    }
    
    setIsProcessing(true);

    try {
      // Parse intent from user message
      const intent = parseIntent(userInput);
      
      // Context-aware fallback: if last question was about age and user typed a standalone number
      if (!intent.childAge && lastQuestionType === 'age') {
        const ageMatch = userInput.match(/^\s*(\d{1,2})\s*$/);
        if (ageMatch) {
          const age = parseInt(ageMatch[1], 10);
          if (age >= 3 && age <= 18) {
            intent.childAge = age;
            intent.hasIntent = true;
            console.log('[HARNESS] Context-aware age extraction:', age);
            addLog("success", "system", `Context-aware age extraction: ${age}`, { age });
          }
        }
      }
      
      console.log('[HARNESS] Parsed intent:', intent);
      addLog("info", "system", "Intent parsed", intent);
      
      // Clear lastQuestionType after processing response
      if (intent.hasIntent) {
        setLastQuestionType(null);
      }
      
      // Update state with extracted intent
      if (intent.hasIntent) {
        setState(prev => ({
          ...prev,
          category: intent.category || prev.category,
          childAge: intent.childAge || prev.childAge,
        }));
      }
      
      // Call orchestrator with intent parameters
      // Phase 3: Send structured AAP object if available
      const response = await sendMessage(
        userInput, 
        sessionId, 
        userLocation || undefined, 
        getUserJwt(),
        state.aap,  // NEW: Pass structured AAP object
        intent.category || state.category,  // Legacy fallback
        intent.childAge || state.childAge   // Legacy fallback
      );
      
      console.log('[HARNESS] Orchestrator response:', response);
      
      // Render assistant message with cards (with tone validation context)
      addAssistantMessage(
        response.message,
        response.cards ? "cards" : undefined,
        { cards: response.cards, cta: response.cta },
        response.contextUpdates?.step || state.step
      );
      
      // Update local state if context changed
      if (response.contextUpdates) {
        setState(prev => ({ 
          ...prev, 
          ...response.contextUpdates,
          // Phase 3: Update AAP state from backend
          aap: response.contextUpdates.aap || prev.aap,
          ready_for_discovery: response.contextUpdates.ready_for_discovery ?? prev.ready_for_discovery,
          feedQuery: response.contextUpdates.feedQuery || prev.feedQuery,
          discoveryNotes: response.contextUpdates.discoveryNotes || prev.discoveryNotes
        }));
        
        // Log AAP updates for debugging
        if (response.contextUpdates.aap) {
          console.log('[AAP STATE UPDATE]', {
            aap: response.contextUpdates.aap,
            ready_for_discovery: response.contextUpdates.ready_for_discovery
          });
          addLog("info", "system", "AAP State Updated", response.contextUpdates.aap);
        }
      }
    } catch (error: any) {
      console.error('[HARNESS] Error handling user input:', error);
      handleError(error.message);
    } finally {
      setIsProcessing(false);
      console.log('[HARNESS] ===== INPUT PROCESSED =====');
    }
  };

  // ============= Comprehensive Testing =============

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Run comprehensive tests - both Orchestrator and MCP Direct modes
   */
  const runComprehensiveTests = async () => {
    setIsDemoRunning(true);
    addLog("info", "test", "🧪 Starting comprehensive test suite (Orchestrator + MCP Direct)");
    
    // Clear previous results
    testTracker.clear();
    setCoverageReport(null);

    try {
      // PHASE 1: Orchestrator Mode
      addAssistantMessage("📋 **PHASE 1: Testing Orchestrator Mode (REST API)**");
      await delay(1000);
      await runOrchestratorTests();
      
      await delay(2000);
      
      // PHASE 2: MCP Direct Mode
      addAssistantMessage("🔧 **PHASE 2: Testing MCP Direct Mode (Raw Tools)**");
      await delay(1000);
      await runMCPDirectTests();
      
      await delay(2000);
      
      // PHASE 3: Generate comparison report
      addAssistantMessage("📊 **PHASE 3: Generating Coverage Report**");
      const report = testTracker.generateReport();
      setCoverageReport(report);
      
      addLog("success", "test", "Comprehensive tests completed", { report });
      
      // Display summary
      const summary = `
**Test Summary:**
- Orchestrator: ${report.orchestratorCoverage.stepsCompleted} steps, ${report.orchestratorCoverage.cardsGenerated} cards, ${report.orchestratorCoverage.ctasGenerated} CTAs
- MCP Direct: ${report.mcpCoverage.toolsCalled} tools called, ${report.mcpCoverage.rawResponsesReceived} successful
- Overall: ${report.overallPassed ? '✅ PASSED' : '❌ FAILED'}
      `.trim();
      
      addAssistantMessage(summary);
      
      toast({
        title: report.overallPassed ? "✅ All Tests Passed" : "⚠️ Some Tests Failed",
        description: `Orchestrator: ${report.orchestratorCoverage.stepsCompleted} steps | MCP: ${report.mcpCoverage.toolsCalled} tools`,
      });
      
    } catch (error) {
      console.error("[Comprehensive Tests] Error:", error);
      addLog("error", "test", "Comprehensive tests failed", { error: error instanceof Error ? error.message : "Unknown error" });
      handleError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsDemoRunning(false);
    }
  };

  /**
   * Run orchestrator mode tests
   */
  const runOrchestratorTests = async () => {
    const sessionId = `orchestrator-test-${Date.now()}`;
    
    for (const scenario of TEST_SCENARIOS) {
      addLog("info", "orchestrator", `Testing: ${scenario.name}`);
      const startTime = Date.now();
      const errors: string[] = [];
      
      try {
        const response = await sendMessage(scenario.orchestratorInput, sessionId, userLocation || undefined, getUserJwt());
        const timing = Date.now() - startTime;
        
        const result: TestResult = {
          mode: 'orchestrator',
          step: scenario.id,
          input: scenario.orchestratorInput,
          output: response,
          timing,
          errors,
          timestamp: new Date(),
        };
        
        testTracker.addResult(result);
        addLog("success", "orchestrator", `${scenario.name} completed in ${timing}ms`);
        
        // Visual feedback
        addAssistantMessage(
          `✅ Orchestrator: ${scenario.name} (${timing}ms)`,
          response.cards ? "cards" : undefined,
          { cards: response.cards, cta: response.cta }
        );
        
      } catch (error: any) {
        errors.push(error.message);
        const result: TestResult = {
          mode: 'orchestrator',
          step: scenario.id,
          input: scenario.orchestratorInput,
          output: { error: error.message },
          timing: Date.now() - startTime,
          errors,
          timestamp: new Date(),
        };
        testTracker.addResult(result);
        addLog("error", "orchestrator", `${scenario.name} failed`, { error: error.message });
      }
      
      await delay(1000);
    }
  };

  /**
   * Run MCP direct mode tests
   */
  const runMCPDirectTests = async () => {
    for (const scenario of TEST_SCENARIOS) {
      addLog("info", "mcp", `Testing tool: ${scenario.mcpToolCall.tool}`);
      const startTime = Date.now();
      const errors: string[] = [];
      
      try {
        const response = await callMCPTool(
          scenario.mcpToolCall.tool,
          scenario.mcpToolCall.args
        );
        const timing = Date.now() - startTime;
        
        const result: TestResult = {
          mode: 'mcp-direct',
          step: scenario.id,
          input: scenario.mcpToolCall,
          output: response,
          timing,
          errors,
          timestamp: new Date(),
        };
        
        testTracker.addResult(result);
        addLog("success", "mcp", `${scenario.mcpToolCall.tool} completed in ${timing}ms`);
        
        // Visual feedback with raw output
        addAssistantMessage(
          `✅ MCP Direct: ${scenario.name} (${timing}ms)`,
          undefined,
          { rawMCP: response }
        );
        
      } catch (error: any) {
        errors.push(error.message);
        const result: TestResult = {
          mode: 'mcp-direct',
          step: scenario.id,
          input: scenario.mcpToolCall,
          output: { error: error.message },
          timing: Date.now() - startTime,
          errors,
          timestamp: new Date(),
        };
        testTracker.addResult(result);
        addLog("error", "mcp", `${scenario.mcpToolCall.tool} failed`, { error: error.message });
      }
      
      await delay(1000);
    }
  };

  // ============= Demo Flow =============

  /**
   * Execute automated demo flow
   * Simulates a complete signup process via orchestrator
   */
  const runDemoFlow = async () => {
    setIsDemoRunning(true);
    addLog("info", "system", "🤖 Starting MCP Direct demo flow");

    // Reset conversation
    resetConversation(false);
    addAssistantMessage("🤖 Demo Mode: Testing MCP tool calls directly...");

    await delay(1000);

    try {
      // Step 1: Test find_programs
      addUserMessage("Finding programs at Blackhawk Ski Club");
      setIsProcessing(true);
      addLog("info", "mcp", "Calling scp.find_programs");
      
      const programsResult = await callMCPTool('scp.find_programs', {
        org_ref: 'blackhawk',
        query: 'ski lessons'
      });
      
      setIsProcessing(false);
      
      if (programsResult.success && programsResult.data?.programs) {
        const programs = programsResult.data.programs;
        addAssistantMessage(
          `Found ${programs.length} programs at Blackhawk Ski Club:\n${JSON.stringify(programs.slice(0, 3), null, 2)}`
        );
        addLog("success", "mcp", `Found ${programs.length} programs`);
      } else {
        addAssistantMessage(`No programs found: ${JSON.stringify(programsResult)}`);
        addLog("error", "mcp", "No programs returned");
      }

      await delay(2000);

      // Step 2: Test check_prerequisites
      addUserMessage("Checking prerequisites");
      setIsProcessing(true);
      addLog("info", "mcp", "Calling scp.check_prerequisites");
      
      const prereqResult = await callMCPTool('scp.check_prerequisites', {
        org_ref: 'blackhawk',
        user_id: getUserJwt() ? await supabase.auth.getUser().then(r => r.data.user?.id) : undefined
      });
      
      setIsProcessing(false);
      addAssistantMessage(
        `Prerequisite check complete:\n${JSON.stringify(prereqResult.data, null, 2)}`
      );
      addLog("success", "mcp", "Prerequisites checked");

      await delay(1000);

      addAssistantMessage("🎉 MCP Demo completed! All tools are working.");
      addLog("success", "system", "MCP demo flow completed successfully");

      toast({
        title: "MCP Demo Complete",
        description: "Direct tool calls working successfully!",
      });

    } catch (error) {
      console.error("[Demo] Error during flow:", error);
      addLog("error", "system", "Demo flow failed", { error: error instanceof Error ? error.message : "Unknown error" });
      addAssistantMessage(`❌ Demo failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      toast({
        title: "Demo Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsDemoRunning(false);
    }
  };

  // ============= Reset =============

  /**
   * Reset the conversation to initial state
   * @param showToast - Whether to show a toast notification
   */
  const resetConversation = (showToast = true) => {
    addLog("info", "system", "Resetting conversation");
    
    setMessages([{
      id: "1",
      sender: "assistant",
      text: "Hello! I can assist you with program sign-ups. How can I help today?",
      timestamp: new Date(),
    }]);
    
    setState({
      orgRef: DEFAULT_PROVIDER.defaultOrg,
    });
    
    setInput("");
    setIsProcessing(false);
    setIsDemoRunning(false);
    
    if (showToast) {
      toast({
        title: "Conversation Reset",
        description: "Chat cleared and state reset",
      });
    }
  };

  // ============= Cache Refresh =============

  /**
   * Refresh the program cache with real scraped data
   */
  const handleRefreshCache = async () => {
    setIsRefreshingCache(true);
    addLog("info", "system", "🔄 Starting cache refresh with real data...");

    try {
      const { data, error } = await supabase.functions.invoke('refresh-provider-feed');

      if (error) {
        throw error;
      }

      addLog("success", "system", `✅ Cache refresh complete: ${data.totalPrograms} programs cached`, data);
      
      toast({
        title: "Cache Refreshed",
        description: `Successfully scraped and cached ${data.totalPrograms} programs from ${data.totalSuccesses} sources`,
      });

    } catch (error: any) {
      console.error('[Cache Refresh] Error:', error);
      addLog("error", "system", `❌ Cache refresh failed: ${error.message}`);
      
      toast({
        title: "Cache Refresh Failed",
        description: error.message || "Failed to refresh cache",
        variant: "destructive",
      });
    } finally {
      setIsRefreshingCache(false);
    }
  };

  // ============= Three-Pass Extractor Test =============

  /**
   * Convert extractor output to ChatGPT SDK grouped cards format
   * Follows Design DNA: Message → Cards → CTA
   */
  const formatProgramsAsCards = (programs: any[]) => {
    return {
      type: "cards-grouped",
      groups: [
        {
          title: "Available Programs",
          cards: programs.map(p => ({
            title: p.title,
            subtitle: [p.schedule, p.age_range].filter(Boolean).join(' • '),
            caption: [p.price, p.skill_level].filter(Boolean).join(' • '),
            body: p.description || p.brief || '',
            actions: [
              {
                type: "postback",
                label: p.status === 'waitlist' ? 'Join Waitlist' : 'Choose',
                payload: {
                  action: 'select_program',
                  program_id: p.id || p.program_id,
                  program_ref: p.program_ref
                }
              }
            ]
          }))
        }
      ],
      cta_chips: [
        {
          label: "Show All Programs",
          payload: { action: 'show_all' }
        }
      ]
    };
  };

  const runExtractorTest = async () => {
    addLog("info", "extractor", "🧪 Starting Three-Pass Extractor test...");
    setIsProcessing(true);
    
    try {
      const userId = await supabase.auth.getUser().then(r => r.data.user?.id);
      
      // 🔍 Look up stored credential
      const { data: creds } = await supabase
        .from('stored_credentials')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'skiclubpro')
        .limit(1);
      
      if (!creds || creds.length === 0) {
        addLog("error", "extractor", "No credential found - user must store credentials first");
        addAssistantMessage("⚠️ Please click **🔐 Store Credentials** first to test the extractor with your login.");
        toast({
          title: "❌ No Credentials",
          description: "Store credentials first using the 🔐 button",
          variant: "destructive"
        });
        setIsProcessing(false);
        return;
      }
      
      const credentialId = creds[0].id;
      addLog("info", "extractor", `Found credential: ${credentialId}`);
      
      // ✅ Get user's JWT token for credential lookup
      const { data: { session } } = await supabase.auth.getSession();
      const userJwt = session?.access_token;
      
      if (!userJwt) {
        addLog("error", "extractor", "No active session - please log in");
        addAssistantMessage("⚠️ Please log in to run the extractor test.");
        setIsProcessing(false);
        return;
      }
      
      addLog("info", "extractor", "✅ User JWT obtained for credential lookup");
      
      // FIX: Perform login first to get session_token (prevents double login)
      addLog("info", "extractor", "🔐 Performing login to get session token...");
      addAssistantMessage("🔐 Logging in to get session token (prevents double login)...");
      
      const loginResult = await callMCPTool('scp.login', {
        org_ref: 'blackhawk-ski',
        credential_id: credentialId,
        user_jwt: userJwt
      });
      
      if (!loginResult.success) {
        addLog("error", "extractor", `Login failed: ${loginResult.error}`);
        addAssistantMessage(`❌ Login failed: ${loginResult.error}. Check logs for details.`);
        setIsProcessing(false);
        return;
      }
      
      const sessionToken = loginResult.session_token;
      addLog("info", "extractor", `✅ Login successful, session_token: ${sessionToken}`);
      
      // Now call find_programs with session_token (should reuse session, no double login)
      addAssistantMessage("🔍 Running Three-Pass Extractor (reusing login session)...");
      
      const result = await callMCPTool('scp.find_programs', {
        org_ref: 'blackhawk-ski',
        credential_id: credentialId,
        user_jwt: userJwt,  // CRITICAL: Required for credential decryption
        session_token: sessionToken,  // CRITICAL: Reuse session to prevent double login
        query: '',
        category: 'all'
      });
      
      addLog("info", "extractor", `MCP Response: ${JSON.stringify(result, null, 2)}`);
      
      // Check if we got programs in data
      if (result.data?.programs && result.data.programs.length > 0) {
        const programs = result.data.programs;
        addLog("success", "extractor", `✅ Found ${programs.length} programs (login_status: ${result.login_status || 'success'})`);
        
        // 🎨 Format as SDK-compliant cards
        const cardsPayload = formatProgramsAsCards(programs);
        
        // Display assistant message
        addAssistantMessage(
          `✅ Found ${programs.length} programs at Blackhawk Ski Club.\n\n` +
          `I've organized them below — tap any card to explore or enroll. ` +
          `(Your login session stays active; no extra logins.)`
        );
        
        // 🆕 Add grouped cards to messages
        setMessages(prev => [
          ...prev,
          {
            id: `cards-${Date.now()}`,
            sender: 'assistant' as const,
            text: '',
            timestamp: new Date(),
            componentType: 'cards-grouped' as const,
            componentData: cardsPayload
          }
        ]);
        
        // Also log plain text summary for debugging
        addLog("info", "extractor", programs.map((p: any, i: number) => 
          `${i + 1}. ${p.title} - ${p.price || 'N/A'}`
        ).join('\n'));
        
        toast({
          title: "✅ Extractor Test Passed",
          description: `Successfully extracted ${programs.length} programs`,
        });
      } else {
        const errorMsg = result.error || result.login_status || "No programs in response";
        addLog("error", "extractor", `Extractor failed: ${errorMsg}`, result);
        addAssistantMessage(`❌ Extractor test failed: ${errorMsg}\n\nFull response:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error("[Extractor Test] Error:", error);
      addLog("error", "extractor", "Extractor test failed", { 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
      if (!(error instanceof Error && error.message.includes("Extractor failed"))) {
        addAssistantMessage(`❌ Extractor test failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
      
      toast({
        title: "❌ Extractor Test Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ============= Health Check =============

  const runHealthCheck = async () => {
    setIsCheckingHealth(true);
    addLog("info", "system", "Running MCP health check...");
    
    const result = await checkMCPHealth();
    setHealthCheckResult(result);
    
    if (result.ok) {
      addLog("success", "system", `Health check passed - ${result.details.toolCount} tools available`);
      toast({
        title: "✅ MCP Connection Healthy",
        description: `${result.details.toolCount} tools available`,
      });
    } else {
      addLog("error", "system", `Health check failed: ${result.details.error}`);
      toast({
        title: "❌ MCP Connection Failed",
        description: result.details.error || "Check console for details",
        variant: "destructive",
      });
    }
    
    setIsCheckingHealth(false);
  };

  // ============= Initialization =============

  useEffect(() => {
    addLog("info", "system", "Initializing chat test harness...");
    
    // Check MCP health
    checkMCPHealth().then((result) => {
      setMcpConnected(result.ok);
      if (!result.ok) {
        addLog("error", "system", "MCP server connection failed");
        addAssistantMessage(
          "⚠️ Warning: MCP server connection failed. Make sure the server is running."
        );
      } else {
        addLog("success", "system", "MCP server connected successfully");
      }
    });
  }, []);

  // ============= Render =============

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <HarnessHeader
        mcpConnected={mcpConnected}
        isDemoRunning={isDemoRunning}
        isProcessing={isProcessing}
        onRunDemo={runDemoFlow}
        onReset={() => resetConversation()}
        onRefreshCache={handleRefreshCache}
        isRefreshingCache={isRefreshingCache}
        mcpUrl={import.meta.env.VITE_MCP_BASE_URL}
      />

      {/* Test Coverage Report */}
      {coverageReport && (
        <div className="px-4 py-2">
          <TestCoveragePanel report={coverageReport} />
        </div>
      )}

      {/* MCP Diagnostics Panel */}
      <div className="px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Button 
            onClick={runHealthCheck} 
            disabled={isCheckingHealth}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <Activity className="h-4 w-4" />
            {isCheckingHealth ? "Checking..." : "Test Connection"}
          </Button>

          <Button 
            onClick={() => setShowSystemUserSetup(true)} 
            disabled={isProcessing}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            ⚙️ System User Setup
          </Button>

          <Button 
            onClick={() => {
              setLoginDialogData({
                provider: 'skiclubpro',
                orgName: 'Blackhawk Ski Club',
                orgRef: 'blackhawk-ski'
              });
              setShowLoginDialog(true);
            }} 
            disabled={isProcessing}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            🔐 Store Credentials
          </Button>

          <Button 
            onClick={runExtractorTest} 
            disabled={isProcessing}
            size="sm"
            variant="default"
            className="gap-2"
          >
            🔍 Test Extractor
          </Button>
          
          {healthCheckResult && (
            <div className="flex items-center gap-4">
              {healthCheckResult.ok ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700">Health: OK</span>
                  </div>
                  <Badge variant="outline" className="gap-1">
                    <span className="text-xs">Tools: {healthCheckResult.details.toolCount}</span>
                  </Badge>
                  {healthCheckResult.details.tools && healthCheckResult.details.tools.length > 0 && (
                    <span className="text-xs text-muted-foreground truncate max-w-md">
                      {healthCheckResult.details.tools.slice(0, 5).map(t => t.name).join(', ')}
                      {healthCheckResult.details.tools.length > 5 && '...'}
                    </span>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    {healthCheckResult.details.error || 'Connection failed'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>


      <MessageList
        messages={messages}
        isProcessing={isProcessing}
        mcpConnected={mcpConnected}
        onAction={handleCardAction}
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={isProcessing}
      />

      <DebugPanel
        logs={debugLogs}
        isVisible={showDebugPanel}
        onToggle={() => setShowDebugPanel(!showDebugPanel)}
        onClear={() => setDebugLogs([])}
      />

      {/* Login Credential Dialog */}
      {loginDialogData && (
        <LoginCredentialDialog
          open={showLoginDialog}
          onOpenChange={setShowLoginDialog}
          provider={loginDialogData.provider}
          orgName={loginDialogData.orgName}
          orgRef={loginDialogData.orgRef}
          onSuccess={(credentialData) => {
            setShowLoginDialog(false);
            addLog("success", "system", "Credentials stored successfully", credentialData);
            
            // Forward credentials to orchestrator
            if (credentialData) {
              handleCardAction('credentials_submitted', credentialData);
            }
          }}
        />
      )}

      {/* System User Setup Dialog */}
      <Dialog open={showSystemUserSetup} onOpenChange={setShowSystemUserSetup}>
        <DialogContent className="max-w-2xl">
          <SystemUserSetup />
        </DialogContent>
      </Dialog>
    </div>
  );
}
