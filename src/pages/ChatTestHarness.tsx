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
import type { ChatMessage } from "@/components/chat-test/MessageBubble";
import { initializeMCP, checkMCPHealth, type MCPHealthCheckResult } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Activity } from "lucide-react";
import {
  executeLogin,
  executeSearch,
  executeProgramSelect,
  executePrerequisiteCheck,
  executeRegistration,
  type OrchestratorContext,
} from "@/lib/chatFlowOrchestrator";
import {
  formatFormRequest,
  formatErrorResponse,
} from "@/lib/chatResponseParser";
import {
  DEMO_TEST_DATA,
  DEFAULT_PROVIDER,
  MOCK_PROGRAMS,
  MOCK_PREREQUISITE_STATUSES,
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

  const { toast } = useToast();

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

  // ============= Flow Handlers =============

  /**
   * Create orchestrator context from current state
   */
  const createContext = (): OrchestratorContext => ({
    orgRef: state.orgRef,
    sessionRef: state.sessionRef,
    selectedProgram: state.selectedProgram,
    addLog,
  });

  /**
   * Handle program search
   */
  const handleSearchPrograms = async (query: string) => {
    if (!mcpConnected) {
      handleError("MCP server not connected");
      return;
    }

    console.log('[HARNESS] Program search initiated');
    console.log('[MCP] → calling tool: scp:find_programs');
    addLog("info", "tool", `Searching for programs: ${query}`);
    
    setIsProcessing(true);
    addUserMessage(query);

    const result = await executeSearch(query, createContext());

    if (result.success) {
      console.log('[MCP] ✅ Programs found:', result.componentData?.programs?.length || 0);
      addAssistantMessage(result.text, result.componentType, result.componentData);
    } else {
      console.log('[MCP] ❌ Program search failed');
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle program selection
   */
  const handleProgramSelect = async (program: any) => {
    console.log('[HARNESS] Program selected:', program.title);
    addLog("info", "user", "Program selected", { programId: program.id, title: program.title });
    addUserMessage(`I'll take **${program.title}**`);
    setIsProcessing(true);

    const result = await executeProgramSelect(program, createContext());

    if (result.success && result.stateUpdate) {
      console.log('[HARNESS] → Program selection successful, updating state');
      setState({ ...state, ...result.stateUpdate });
      addAssistantMessage(result.text, result.componentType, result.componentData);
    } else {
      console.log('[HARNESS] ❌ Program selection failed');
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle registration confirmation
   */
  const handleConfirmRegistration = async () => {
    console.log('[HARNESS] Registration confirmation requested');
    addLog("info", "user", "User confirmed registration");
    addUserMessage("Yes, confirm!");
    setIsProcessing(true);

    const result = await executePrerequisiteCheck(createContext());

    if (result.success) {
      console.log('[HARNESS] ✅ Prerequisites check passed');
      addAssistantMessage(result.text, result.componentType, result.componentData);

      // Check if form is needed
      const missingPrereqs = [];
      if (!state.sessionRef) missingPrereqs.push("login");
      if (!result.componentData?.waiver_signed) missingPrereqs.push("waiver");
      if (!result.componentData?.emergency_contact) missingPrereqs.push("emergency_contact");

      if (missingPrereqs.length > 0) {
        console.log('[HARNESS] → Missing prerequisites:', missingPrereqs);
        setTimeout(() => {
          const formResponse = formatFormRequest(missingPrereqs);
          addAssistantMessage(
            formResponse.text,
            formResponse.componentType,
            formResponse.componentData
          );
        }, 1000);
      }
    } else {
      console.log('[HARNESS] ❌ Prerequisites check failed');
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle form submission
   */
  const handleFormSubmit = async (formId: string, values: Record<string, any>) => {
    console.log('[HARNESS] Form submitted:', formId);
    addLog("info", "user", "Form submitted", { formId, fields: Object.keys(values) });
    setIsProcessing(true);

    try {
      // Login form
      if (values.email && values.password) {
        console.log('[HARNESS] → Processing login form');
        console.log('[MCP] → calling tool: scp:login');
        addUserMessage("Signing in...");

        const result = await executeLogin(values.email, values.password, createContext());

        if (result.success && result.stateUpdate) {
          console.log('[MCP] ✅ Login successful');
          setState({ ...state, ...result.stateUpdate });
          addAssistantMessage(result.text);

          // Show next form after successful login
          setTimeout(() => {
            const formResponse = formatFormRequest(["registration_details"]);
            addAssistantMessage(
              formResponse.text,
              formResponse.componentType,
              formResponse.componentData
            );
          }, 1000);
        } else {
          console.log('[MCP] ❌ Login failed');
          addAssistantMessage(result.text);
        }
      }
      // Registration details form
      else if (values.childName) {
        console.log('[HARNESS] → Processing registration form');
        console.log('[MCP] → calling tool: scp:submit_registration');
        addUserMessage("Submitting registration...");

        const result = await executeRegistration(values.childName, createContext());

        if (result.success && result.stateUpdate) {
          console.log('[MCP] ✅ Registration successful');
          setState({ ...state, ...result.stateUpdate });
          addAssistantMessage(result.text);

          toast({
            title: "Success",
            description: "Registration completed!",
          });
        } else {
          console.log('[MCP] ❌ Registration failed');
          addAssistantMessage(result.text);
        }
      }
    } catch (error) {
      console.error('[HARNESS] Form submission error:', error);
      const errorResponse = formatErrorResponse(
        error instanceof Error ? error.message : "Unknown error",
        "submitting form"
      );
      addAssistantMessage(errorResponse.text);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Determine current step based on conversation state
   * Follows the orchestrated signup flow pattern
   */
  const determineCurrentStep = (): string => {
    console.log('[HARNESS] Determining current step', { state });
    
    if (!state.orgRef) return "provider_search";
    if (state.orgRef && !state.sessionRef) return "login";
    if (state.orgRef && state.sessionRef && !state.selectedProgram) return "program_selection";
    if (state.selectedProgram && !state.prerequisitesComplete) return "prerequisite_check";
    return "completed";
  };

  /**
   * Handle sending a message - orchestrated flow version
   * Routes user input through the proper signup steps
   */
  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    setInput("");
    addUserMessage(userInput);
    
    console.log('[HARNESS] ===== USER INPUT =====');
    console.log('[HARNESS] Input:', userInput);
    console.log('[HARNESS] Current state:', state);

    const currentStep = determineCurrentStep();
    console.log('[HARNESS] Current step:', currentStep);
    
    setIsProcessing(true);

    try {
      switch (currentStep) {
        case "provider_search":
          console.log('[HARNESS] → Executing provider search flow');
          await handleProviderSearch(userInput);
          break;
          
        case "login":
          console.log('[HARNESS] → User needs to login first');
          addAssistantMessage(
            `Great! Let's connect your ${state.orgRef} account. Click the Connect Account button to log in securely.`,
            "form",
            {
              id: "login-form",
              title: "Sign In",
              fields: [
                { id: "email", label: "Email", type: "email", required: true, placeholder: "test@example.com" },
                { id: "password", label: "Password", type: "password", required: true, placeholder: "Enter password" },
              ],
            }
          );
          break;
          
        case "program_selection":
          console.log('[HARNESS] → Executing program search');
          await handleSearchPrograms(userInput);
          break;
          
        case "prerequisite_check":
          console.log('[HARNESS] → Checking prerequisites');
          const prereqResult = await executePrerequisiteCheck(createContext());
          if (prereqResult.success) {
            addAssistantMessage(prereqResult.text, prereqResult.componentType, prereqResult.componentData);
          } else {
            addAssistantMessage(prereqResult.text);
          }
          break;
          
        default:
          console.log('[HARNESS] → Default response');
          addAssistantMessage(
            "I can help you find and register for programs. Try saying something like 'I need ski lessons' or 'Show me Blackhawk Ski Club programs'."
          );
      }
    } catch (error) {
      console.error('[HARNESS] Error handling user input:', error);
      addAssistantMessage(
        "Sorry, I encountered an error. Please try again or check the debug panel for details."
      );
    } finally {
      setIsProcessing(false);
      console.log('[HARNESS] ===== INPUT PROCESSED =====');
    }
  };

  /**
   * Handle provider search with card rendering
   */
  const handleProviderSearch = async (query: string) => {
    console.log('[HARNESS] Provider search initiated');
    console.log('[MCP] → calling tool: scp:find_programs');
    addLog("info", "system", `Searching for provider: ${query}`);
    
    const result = await executeSearch(query, createContext());
    
    if (result.success && result.componentData?.programs) {
      console.log('[MCP] ✅ Programs found:', result.componentData.programs.length);
      
      // Show provider confirmation first
      const providerName = state.orgRef || "the provider";
      addAssistantMessage(
        `🔍 I found programs at **${providerName}**. Is this the right provider?`,
        "confirmation",
        {
          title: "Confirm Provider",
          message: `We found ${result.componentData.programs.length} programs at ${providerName}.`,
          confirmLabel: "Yes, that's right",
          cancelLabel: "No, different provider"
        }
      );
      
      // Store programs for next step
      setState(prev => ({ ...prev, availablePrograms: result.componentData?.programs }));
    } else {
      console.log('[MCP] ❌ No programs found');
      addAssistantMessage(
        result.text || "I couldn't find any programs matching that search. Could you try rephrasing or providing more details?"
      );
    }
  };

  // ============= Demo Flow =============

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Execute automated demo flow
   * Simulates a complete signup process from login to completion
   */
  const runDemoFlow = async () => {
    if (!mcpConnected) {
      toast({
        title: "MCP Not Connected",
        description: "Cannot run demo without MCP server connection",
        variant: "destructive",
      });
      return;
    }

    setIsDemoRunning(true);
    addLog("info", "system", "🤖 Starting demo flow automation");

    // Reset conversation
    resetConversation(false);
    addAssistantMessage("🤖 Demo Mode: Starting automated signup flow...");

    await delay(1000);

    try {
      // Step 1: Login
      addAssistantMessage("Let me help you sign in first.");
      await delay(800);

      addUserMessage(`Login with ${DEMO_TEST_DATA.credentials.email}`);
      setIsProcessing(true);

      const loginResult = await executeLogin(
        DEMO_TEST_DATA.credentials.email,
        DEMO_TEST_DATA.credentials.password,
        createContext()
      );

      setIsProcessing(false);

      if (!loginResult.success) {
        addAssistantMessage(`⚠️ Demo: Login failed. Continuing with mock session...`);
        setState(prev => ({ ...prev, sessionRef: "demo-session-mock" }));
      } else {
        if (loginResult.stateUpdate) {
          setState(prev => ({ ...prev, ...loginResult.stateUpdate }));
        }
        addAssistantMessage("✅ Successfully logged in!");
      }

      await delay(1500);

      // Step 2: Search for programs
      addUserMessage(DEMO_TEST_DATA.searchQuery);
      setIsProcessing(true);

      const searchResult = await executeSearch(DEMO_TEST_DATA.searchQuery, createContext());

      setIsProcessing(false);

      addAssistantMessage(
        searchResult.text,
        searchResult.componentType,
        searchResult.componentData
      );

      await delay(2000);

      // Step 3: Auto-select first program
      const selectedProgram = MOCK_PROGRAMS[0];
      addUserMessage(`I'll take ${selectedProgram.title}`);
      setState(prev => ({ ...prev, selectedProgram }));

      setIsProcessing(true);
      await delay(1000);
      setIsProcessing(false);

      addAssistantMessage(
        "Perfect! Please review and confirm your selection:",
        "confirmation",
        {
          title: "Confirm Registration",
          message: `Program: ${selectedProgram.title}\n${selectedProgram.description}\nPrice: $${selectedProgram.price}`,
        }
      );

      await delay(2000);

      // Step 4: Auto-confirm
      addUserMessage("Confirmed!");
      setIsProcessing(true);
      await delay(1000);
      setIsProcessing(false);

      addAssistantMessage(
        "Great! Let's check your prerequisites:",
        "status",
        { statuses: MOCK_PREREQUISITE_STATUSES }
      );

      await delay(1500);

      // Step 5: Auto-show form
      addAssistantMessage(
        "Please provide additional information to complete registration:",
        "form",
        {
          title: "Registration Details",
          fields: [
            { id: "childName", label: "Child's Full Name", type: "text", required: true },
            { id: "emergencyContact", label: "Emergency Contact Phone", type: "text", required: true },
            { id: "waiver", label: "I agree to the terms and waiver", type: "checkbox", required: true },
          ],
        }
      );

      await delay(2500);

      // Step 6: Auto-submit form
      addUserMessage("Submitting registration details...");
      setIsProcessing(true);

      const regResult = await executeRegistration(
        DEMO_TEST_DATA.childInfo.childName,
        createContext()
      );

      setIsProcessing(false);

      if (regResult.success && regResult.stateUpdate) {
        setState(prev => ({ ...prev, ...regResult.stateUpdate }));
      }

      addAssistantMessage(
        `✅ Registration submitted successfully!\n\nChild Name: ${DEMO_TEST_DATA.childInfo.childName}\nEmergency Contact: ${DEMO_TEST_DATA.childInfo.emergencyContact}\n\nYou'll receive a confirmation email shortly.`
      );

      await delay(1000);

      addAssistantMessage("🎉 Demo flow completed! You can now test manually or run the demo again.");

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
    addLog("info", "system", "Initializing MCP connection...");
    initializeMCP().then((connected) => {
      setMcpConnected(connected);
      if (!connected) {
        addLog("error", "system", "MCP server connection failed");
        addAssistantMessage(
          "⚠️ Warning: MCP server connection failed. Make sure the server is running and VITE_MCP_BASE_URL is configured."
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
        onConfirm={handleConfirmRegistration}
        onProgramSelect={handleProgramSelect}
        onFormSubmit={handleFormSubmit}
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
