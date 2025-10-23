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

import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { HarnessHeader } from "@/components/chat-test/HarnessHeader";
import { MessageList } from "@/components/chat-test/MessageList";
import { ChatInput } from "@/components/chat-test/ChatInput";
import { DebugPanel, LogEntry } from "@/components/chat-test/DebugPanel";
import { TestCoveragePanel } from "@/components/chat-test/TestCoveragePanel";
import type { ChatMessage } from "@/components/chat-test/MessageBubble";
import { checkMCPHealth, type MCPHealthCheckResult, callMCPTool } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
import { TestComparisonTracker, type CoverageReport, type TestResult } from "@/lib/testComparison";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import {
  DEFAULT_PROVIDER,
  TEST_SCENARIOS,
} from "@/lib/config/testHarness";

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
}

// ============= Main Component =============

export default function ChatTestHarness() {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "assistant",
      text: "Hello! I can assist you with program sign-ups. How can I help today?",
      timestamp: new Date(),
    }
  ]);
  const [state, setState] = useState<ConversationState>({
    orgRef: DEFAULT_PROVIDER.defaultOrg,
  });
  const [mcpConnected, setMcpConnected] = useState(false);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const [healthCheckResult, setHealthCheckResult] = useState<MCPHealthCheckResult | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [testTracker] = useState(() => new TestComparisonTracker());
  const [coverageReport, setCoverageReport] = useState<CoverageReport | null>(null);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);

  const { toast } = useToast();

  // ============= Geolocation Setup =============

  useEffect(() => {
    // Request user's location on mount for GPS-based provider filtering
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(coords);
          addLog("success", "system", `GPS location acquired: ${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`);
          console.log('[HARNESS] 📍 User location:', coords);
        },
        (error) => {
          addLog("warning", "system", `Geolocation denied: ${error.message} - will use text-based search`);
          console.warn('[HARNESS] Geolocation denied, falling back to text-based search');
        }
      );
    } else {
      addLog("warning", "system", "Geolocation not supported by browser");
    }
  }, []);

  // ============= Logging =============

  const addLog = (level: LogLevel, category: LogCategory, message: string, data?: any) => {
    const entry = createLogEntry(level, category, message, data);
    setDebugLogs(prev => [...prev, entry]);
  };

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
    componentData?: any
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
    
    setIsProcessing(true);

    try {
      // Call orchestrator's handleAction
      const sessionId = state.sessionRef || `session-${Date.now()}`;
      const response = await sendAction(action, payload, sessionId);
      
      console.log('[HARNESS] Action response:', response);
      console.log('[FLOW]', action, '→', response.cards ? `${response.cards.length} cards` : 'no cards');
      
      // Add visual feedback for action
      addUserMessage(`[Action: ${action}]`);
      
      // Render next assistant message with cards
      addAssistantMessage(
        response.message,
        response.cards ? "cards" : undefined,
        { cards: response.cards, cta: response.cta }
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
    if (lowerInput.includes('run full test') || 
        lowerInput.includes('test everything') ||
        lowerInput.includes('comprehensive test')) {
      await runComprehensiveTests();
      return;
    }
    
    setIsProcessing(true);

    try {
      // Call orchestrator instead of direct tools
      const sessionId = state.sessionRef || `session-${Date.now()}`;
      const response = await sendMessage(userInput, sessionId, userLocation || undefined);
      
      console.log('[HARNESS] Orchestrator response:', response);
      
      // Render assistant message with cards
      addAssistantMessage(
        response.message,
        response.cards ? "cards" : undefined,
        { cards: response.cards, cta: response.cta }
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
        const response = await sendMessage(scenario.orchestratorInput, sessionId, userLocation || undefined);
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
    addLog("info", "system", "🤖 Starting demo flow automation");

    // Reset conversation
    resetConversation(false);
    addAssistantMessage("🤖 Demo Mode: Starting automated signup flow...");

    await delay(1000);

    try {
      // Step 1: Provider search
      addUserMessage("I need ski lessons for Blackhawk");
      setIsProcessing(true);

      const sessionId = `demo-session-${Date.now()}`;
      const response1 = await sendMessage("I need ski lessons for Blackhawk", sessionId, userLocation || undefined);
      
      setIsProcessing(false);
      addAssistantMessage(response1.message, response1.cards ? "cards" : undefined, { cards: response1.cards, cta: response1.cta });

      await delay(2000);

      // Step 2: Select provider (simulate clicking first card button)
      if (response1.cards?.[0]?.buttons?.[0]) {
        const action = response1.cards[0].buttons[0].action;
        const payload = response1.cards[0].metadata || {};
        
        addUserMessage("Yes, that's the one");
        setIsProcessing(true);
        
        const response2 = await sendAction(action, payload, sessionId);
        setIsProcessing(false);
        
        addAssistantMessage(response2.message, response2.cards ? "cards" : undefined, { cards: response2.cards, cta: response2.cta });
        
        await delay(2000);
      }

      addAssistantMessage("🎉 Demo flow completed! Continue testing manually.");
      addLog("success", "system", "Demo flow completed successfully");

      toast({
        title: "Demo Complete",
        description: "Automated signup flow finished successfully!",
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
    </div>
  );
}
