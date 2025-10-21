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
import { initializeMCP } from "@/lib/chatMcpClient";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";
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

  const { toast } = useToast();

  // ============= Logging =============

  const addLog = (level: LogLevel, category: LogCategory, message: string, data?: any) => {
    const entry = createLogEntry(level, category, message, data);
    setDebugLogs(prev => [...prev, entry]);
  };

  // ============= Message Helpers =============

  const addUserMessage = (text: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
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
      id: Date.now().toString(),
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

    setIsProcessing(true);
    addUserMessage(query);

    const result = await executeSearch(query, createContext());

    if (result.success) {
      addAssistantMessage(result.text, result.componentType, result.componentData);
    } else {
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle program selection
   */
  const handleProgramSelect = async (program: any) => {
    addLog("info", "user", "Program selected", { programId: program.id, title: program.title });
    addUserMessage(`I'll take **${program.title}**`);
    setIsProcessing(true);

    const result = await executeProgramSelect(program, createContext());

    if (result.success && result.stateUpdate) {
      setState({ ...state, ...result.stateUpdate });
      addAssistantMessage(result.text, result.componentType, result.componentData);
    } else {
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle registration confirmation
   */
  const handleConfirmRegistration = async () => {
    addLog("info", "user", "User confirmed registration");
    addUserMessage("Yes, confirm!");
    setIsProcessing(true);

    const result = await executePrerequisiteCheck(createContext());

    if (result.success) {
      addAssistantMessage(result.text, result.componentType, result.componentData);

      // Check if form is needed
      const missingPrereqs = [];
      if (!state.sessionRef) missingPrereqs.push("login");
      if (!result.componentData?.waiver_signed) missingPrereqs.push("waiver");
      if (!result.componentData?.emergency_contact) missingPrereqs.push("emergency_contact");

      if (missingPrereqs.length > 0) {
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
      addAssistantMessage(result.text);
    }

    setIsProcessing(false);
  };

  /**
   * Handle form submission
   */
  const handleFormSubmit = async (formId: string, values: Record<string, any>) => {
    addLog("info", "user", "Form submitted", { formId, fields: Object.keys(values) });
    setIsProcessing(true);

    try {
      // Login form
      if (values.email && values.password) {
        addUserMessage("Signing in...");

        const result = await executeLogin(values.email, values.password, createContext());

        if (result.success && result.stateUpdate) {
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
          addAssistantMessage(result.text);
        }
      }
      // Registration details form
      else if (values.childName) {
        addUserMessage("Submitting registration...");

        const result = await executeRegistration(values.childName, createContext());

        if (result.success && result.stateUpdate) {
          setState({ ...state, ...result.stateUpdate });
          addAssistantMessage(result.text);

          toast({
            title: "Success",
            description: "Registration completed!",
          });
        } else {
          addAssistantMessage(result.text);
        }
      }
    } catch (error) {
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
   * Handle sending a message
   */
  const handleSend = () => {
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    setInput("");

    // Simple keyword-based routing for demo
    if (userInput.toLowerCase().includes("ski") || userInput.toLowerCase().includes("program")) {
      handleSearchPrograms(userInput);
    } else {
      addUserMessage(userInput);
      addAssistantMessage(
        "I can help you find and register for programs. Try saying something like 'I need ski lessons for my child'."
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
