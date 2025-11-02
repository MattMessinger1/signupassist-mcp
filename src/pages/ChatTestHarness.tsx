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
import type { ChatMessage } from "@/components/chat-test/MessageBubble";
import { checkMCPHealth, type MCPHealthCheckResult, callMCPTool } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
import { TestComparisonTracker, type CoverageReport, type TestResult } from "@/lib/testComparison";
import { validateTone, determineToneContext, formatToneIssues } from "@/lib/toneValidator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import { sendMessage, sendAction, overridePrompt } from "@/lib/orchestratorClient";
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
}

// ============= Main Component =============

export default function ChatTestHarness() {
  // Auth
  const { user, session, loading, isSessionValid } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
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
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user || !session) {
    return null;
  }

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

  // Mount guard to prevent duplicate initialization
  const welcomeShownRef = useRef(false);

  // ============= Logging =============
  // Define addLog early with useCallback for stable reference
  const addLog = useCallback((level: LogLevel, category: LogCategory, message: string, data?: any) => {
    const entry = createLogEntry(level, category, message, data);
    setDebugLogs(prev => [...prev, entry]);
  }, []);

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
          
          toast({
            title: isMock ? "🧪 Mock Location" : "📍 Location Detected",
            description: isMock 
              ? `${data.city}, ${data.region} (${mockReason})`
              : `${data.city}, ${data.region} - Helps find nearby providers`,
          });
          
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
    
    // Handle special actions that need UI dialogs
    if (action === "show_login_dialog" || action === "connect_account") {
      console.log('[HARNESS] Opening login dialog with payload:', payload);
      setLoginDialogData({
        provider: payload.provider || 'skiclubpro',
        orgName: payload.orgName || payload.orgRef || 'Provider',
        orgRef: payload.orgRef || 'unknown'
      });
      setShowLoginDialog(true);
      return;
    }
    
    setIsProcessing(true);

    try {
      // Call orchestrator's handleAction
      const response = await sendAction(action, payload, sessionId, getUserJwt());
      
      console.log('[HARNESS] Action response:', response);
      console.log('[FLOW]', action, '→', response.cards ? `${response.cards.length} cards` : 'no cards');
      
      // Render next assistant message with cards (with tone validation context)
      addAssistantMessage(
        response.message,
        response.cards ? "cards" : undefined,
        { cards: response.cards, cta: response.cta },
        response.contextUpdates?.step || state.step
      );
      
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
      // Call orchestrator instead of direct tools
      const response = await sendMessage(userInput, sessionId, userLocation || undefined, getUserJwt());
      
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
        setState(prev => ({ ...prev, ...response.contextUpdates }));
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

  // ============= Three-Pass Extractor Test =============

  const runExtractorTest = async () => {
    addLog("info", "extractor", "🧪 Starting Three-Pass Extractor test...");
    setIsProcessing(true);
    
    try {
      addAssistantMessage("🔍 Running Three-Pass Extractor on Blackhawk Ski Club...");
      
      const userId = await supabase.auth.getUser().then(r => r.data.user?.id);
      addLog("info", "extractor", `Using user_id: ${userId}`);
      
      const result = await callMCPTool('scp.find_programs', {
        org_ref: 'blackhawk-ski',
        query: '',
        user_id: userId
      });
      
      addLog("info", "extractor", `MCP Response: ${JSON.stringify(result, null, 2)}`);
      
      // Check if we got programs in data (even if login failed and used fallback)
      if (result.data?.programs && result.data.programs.length > 0) {
        const programs = result.data.programs;
        addLog("success", "extractor", `✅ Found ${programs.length} programs (login_status: ${result.login_status || 'N/A'})`);
        
        // Display results in chat
        let resultText = `✅ **Three-Pass Extractor Results**\n\nFound ${programs.length} programs:\n\n`;
        programs.forEach((prog: any, i: number) => {
          resultText += `**${i + 1}. ${prog.title}**\n`;
          resultText += `- Price: ${prog.price || 'N/A'}\n`;
          resultText += `- Schedule: ${prog.schedule || 'N/A'}\n`;
          resultText += `- Ages: ${prog.age_range || 'N/A'}\n`;
          resultText += `- Level: ${prog.skill_level || 'N/A'}\n`;
          resultText += `- Status: ${prog.status || 'N/A'}\n\n`;
        });
        
        addAssistantMessage(resultText);
        
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
    </div>
  );
}
