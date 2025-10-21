import { useState, useRef, useEffect } from "react";
import { Send, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ConfirmationCard } from "@/components/chat-test/ConfirmationCard";
import { OptionsCarousel } from "@/components/chat-test/OptionsCarousel";
import { InlineChatForm } from "@/components/chat-test/InlineChatForm";
import { StatusChip } from "@/components/chat-test/StatusChip";
import { DebugPanel, LogEntry } from "@/components/chat-test/DebugPanel";
import { initializeMCP, callMCPTool, mcpLogin, mcpFindPrograms, mcpCheckPrerequisites } from "@/lib/chatMcpClient";
import { useToast } from "@/hooks/use-toast";
import {
  parseLoginResponse,
  parseProgramSearchResponse,
  parseProgramSelectionResponse,
  parsePrerequisiteResponse,
  formatFormRequest,
  parseRegistrationResponse,
  formatErrorResponse,
} from "@/lib/chatResponseParser";
import { createLogEntry, type LogLevel, type LogCategory } from "@/lib/debugLogger";

// Test data for demo flow
const DEMO_TEST_DATA = {
  credentials: {
    email: "test@example.com",
    password: "testpass123",
  },
  searchQuery: "ski lessons for kids",
  childInfo: {
    childName: "Alex Johnson",
    emergencyContact: "555-0123",
    waiver: true,
  },
};

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  componentType?: "confirmation" | "carousel" | "form" | "status";
  componentData?: any;
}

interface ConversationState {
  sessionRef?: string;
  orgRef?: string;
  selectedProgram?: any;
  childId?: string;
  registrationRef?: string;
  prerequisites?: any[];
}

export default function ChatTestHarness() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "assistant",
      text: "Hello! I can assist you with program sign-ups. How can I help today?",
      timestamp: new Date(),
    }
  ]);
  const [state, setState] = useState<ConversationState>({
    orgRef: "blackhawk-ski-club", // Default for testing
  });
  const [mcpConnected, setMcpConnected] = useState(false);
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDemoRunning, setIsDemoRunning] = useState(false);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Logging helper
  const addLog = (level: LogLevel, category: LogCategory, message: string, data?: any) => {
    const entry = createLogEntry(level, category, message, data);
    setDebugLogs(prev => [...prev, entry]);
  };

  // Initialize MCP connection on mount
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const addUserMessage = (text: string) => {
    const newMessage: Message = {
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
    componentType?: Message["componentType"],
    componentData?: any
  ) => {
    const newMessage: Message = {
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

  const handleSearchPrograms = async (query: string) => {
    if (!mcpConnected) {
      handleError("MCP server not connected");
      return;
    }

    setIsProcessing(true);
    addUserMessage(query);

    try {
      addLog("info", "tool", "Calling mcpFindPrograms", { 
        orgRef: state.orgRef || "blackhawk-ski-club", 
        query 
      });
      const result = await mcpFindPrograms(state.orgRef || "blackhawk-ski-club", query);
      addLog("success", "tool", "mcpFindPrograms response received", { success: result.success });

      if (!result.success) {
        const errorResponse = formatErrorResponse(
          result.error || "Failed to search programs",
          "searching for programs"
        );
        addAssistantMessage(errorResponse.text);
        return;
      }

      // Mock programs for demo - in production, use result.data
      const mockPrograms = [
        { 
          id: "ski-l1", 
          title: "Ski Lessons - Level 1", 
          description: "Beginner slopes, Ages 6-10",
          price: 120,
          schedule: "Saturdays 9am-12pm"
        },
        { 
          id: "ski-l2", 
          title: "Ski Lessons - Level 2", 
          description: "Intermediate, Ages 8-14",
          price: 150,
          schedule: "Saturdays 1pm-4pm"
        },
        { 
          id: "snowboard-101", 
          title: "Snowboarding 101", 
          description: "Beginner course, Ages 10+",
          price: 140,
          schedule: "Sundays 10am-1pm"
        },
      ];

      const response = parseProgramSearchResponse(
        { programs: mockPrograms },
        query
      );

      addAssistantMessage(response.text, response.componentType, response.componentData);
    } catch (error) {
      const errorResponse = formatErrorResponse(
        error instanceof Error ? error.message : "Unknown error",
        "searching for programs"
      );
      addAssistantMessage(errorResponse.text);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProgramSelect = async (program: any) => {
    addLog("info", "user", "Program selected", { programId: program.id, title: program.title });
    console.log("[Chat] Program selected:", program);
    setState({ ...state, selectedProgram: program });

    addUserMessage(`I'll take **${program.title}**`);
    setIsProcessing(true);

    try {
      addLog("info", "tool", "Calling mcpCheckPrerequisites", { 
        orgRef: state.orgRef || "blackhawk-ski-club", 
        programId: program.id 
      });
      // Check prerequisites for this program
      const prereqResult = await mcpCheckPrerequisites(
        state.orgRef || "blackhawk-ski-club",
        program.id
      );
      addLog("success", "tool", "mcpCheckPrerequisites response received", { success: prereqResult.success });

      if (!prereqResult.success) {
        const errorResponse = formatErrorResponse(
          prereqResult.error || "Failed to check prerequisites",
          "checking prerequisites"
        );
        addAssistantMessage(errorResponse.text);
        return;
      }

      // Parse and show confirmation
      const response = parseProgramSelectionResponse(program, prereqResult.data);
      addAssistantMessage(response.text, response.componentType, response.componentData);
    } catch (error) {
      const errorResponse = formatErrorResponse(
        error instanceof Error ? error.message : "Unknown error",
        "selecting program"
      );
      addAssistantMessage(errorResponse.text);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRegistration = async () => {
    addLog("info", "user", "User confirmed registration");
    console.log("[Chat] Registration confirmed");
    addUserMessage("Yes, confirm!");

    setIsProcessing(true);

    try {
      addLog("info", "tool", "Calling mcpCheckPrerequisites", { orgRef: state.orgRef || "blackhawk-ski-club" });
      // Check prerequisites
      const prereqResult = await mcpCheckPrerequisites(state.orgRef || "blackhawk-ski-club");
      addLog("success", "tool", "mcpCheckPrerequisites response received", { success: prereqResult.success });

      if (!prereqResult.success) {
        const errorResponse = formatErrorResponse(
          prereqResult.error || "Failed to check prerequisites",
          "checking prerequisites"
        );
        addAssistantMessage(errorResponse.text);
        return;
      }

      // Parse prerequisite status
      const response = parsePrerequisiteResponse(
        prereqResult.data || {},
        !!state.sessionRef
      );
      addAssistantMessage(response.text, response.componentType, response.componentData);

      // Determine what's missing and show appropriate form
      const missingPrereqs = [];
      if (!state.sessionRef) missingPrereqs.push("login");
      if (!prereqResult.data?.waiver_signed) missingPrereqs.push("waiver");
      if (!prereqResult.data?.emergency_contact) missingPrereqs.push("emergency_contact");

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
    } catch (error) {
      const errorResponse = formatErrorResponse(
        error instanceof Error ? error.message : "Unknown error",
        "confirming registration"
      );
      addAssistantMessage(errorResponse.text);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFormSubmit = async (formId: string, values: Record<string, any>) => {
    addLog("info", "user", "Form submitted", { formId, fields: Object.keys(values) });
    console.log("[Chat] Form submitted:", formId, values);

    setIsProcessing(true);

    try {
      // If this is a login form
      if (values.email && values.password) {
        addUserMessage("Signing in...");

        addLog("info", "tool", "Calling mcpLogin", { 
          email: values.email, 
          orgRef: state.orgRef || "blackhawk-ski-club" 
        });
        const loginResult = await mcpLogin(
          values.email,
          values.password,
          state.orgRef || "blackhawk-ski-club"
        );
        addLog(loginResult.success ? "success" : "error", "tool", "mcpLogin response received", { 
          success: loginResult.success 
        });

        if (!loginResult.success) {
          const errorResponse = formatErrorResponse(
            loginResult.error || "Login failed",
            "logging in"
          );
          addAssistantMessage(errorResponse.text);
          return;
        }

        setState({ ...state, sessionRef: loginResult.session_ref });

        const response = parseLoginResponse(loginResult, values.email);
        addAssistantMessage(response.text);

        // After successful login, proceed to next step
        setTimeout(() => {
          const formResponse = formatFormRequest(["registration_details"]);
          addAssistantMessage(
            formResponse.text,
            formResponse.componentType,
            formResponse.componentData
          );
        }, 1000);
      }
      // If this is registration details form
      else if (values.childName) {
        addUserMessage("Submitting registration...");

        addLog("info", "tool", "Simulating registration submission", { childName: values.childName });
        // Simulate registration call
        const mockResult = { success: true };
        addLog("success", "tool", "Registration submission successful");
        
        const response = parseRegistrationResponse(mockResult, values.childName);
        addAssistantMessage(response.text);

        toast({
          title: "Success",
          description: "Registration completed!",
        });
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    
    // Reset chat
    setMessages([{
      id: "demo-start",
      sender: "assistant",
      text: "🤖 Demo Mode: Starting automated signup flow...",
      timestamp: new Date(),
    }]);
    setState({ orgRef: "blackhawk-ski-club" });

    await delay(1000);

    try {
      // Step 1: Login
      addAssistantMessage("Let me help you sign in first.");
      await delay(800);
      
      addUserMessage(`Login with ${DEMO_TEST_DATA.credentials.email}`);
      setIsProcessing(true);

      const loginResult = await mcpLogin(
        DEMO_TEST_DATA.credentials.email,
        DEMO_TEST_DATA.credentials.password,
        state.orgRef || "blackhawk-ski-club"
      );

      setIsProcessing(false);

      if (!loginResult.success) {
        addAssistantMessage(`⚠️ Demo: Login failed (${loginResult.error}). Continuing with mock session...`);
        setState(prev => ({ ...prev, sessionRef: "demo-session-mock" }));
      } else {
        setState(prev => ({ ...prev, sessionRef: loginResult.session_ref }));
        addAssistantMessage("✅ Successfully logged in!");
      }

      await delay(1500);

      // Step 2: Search for programs
      addUserMessage(DEMO_TEST_DATA.searchQuery);
      setIsProcessing(true);

      const searchResult = await mcpFindPrograms(
        state.orgRef || "blackhawk-ski-club",
        DEMO_TEST_DATA.searchQuery
      );

      setIsProcessing(false);

      // Mock programs (in real scenario, parse searchResult.data)
      const mockPrograms = [
        { id: "ski-l1", title: "Ski Lessons - Level 1", description: "Beginner slopes, Ages 6-10" },
        { id: "ski-l2", title: "Ski Lessons - Level 2", description: "Intermediate, Ages 8-14" },
        { id: "snowboard-101", title: "Snowboarding 101", description: "Beginner course, Ages 10+" },
      ];

      addAssistantMessage(
        "I found these programs that match your search:",
        "carousel",
        { options: mockPrograms }
      );

      await delay(2000);

      // Step 3: Auto-select first program
      const selectedProgram = mockPrograms[0];
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
          message: `Program: ${selectedProgram.title}\n${selectedProgram.description}\nPrice: $120`,
        }
      );

      await delay(2000);

      // Step 4: Auto-confirm
      addUserMessage("Confirmed!");
      setIsProcessing(true);

      const prereqResult = await mcpCheckPrerequisites(state.orgRef || "blackhawk-ski-club");

      setIsProcessing(false);

      const prereqStatuses = [
        { label: "Account Login", status: "done" },
        { label: "Waiver Signed", status: "pending" },
        { label: "Payment Info", status: "pending" },
        { label: "Emergency Contact", status: "pending" },
      ];

      addAssistantMessage(
        "Great! Let's check your prerequisites:",
        "status",
        { statuses: prereqStatuses }
      );

      await delay(1500);

      // Step 5: Auto-fill form
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
      await delay(1500);
      setIsProcessing(false);

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

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">SignupAssist Test Harness</h1>
            <p className="text-sm text-muted-foreground">ChatGPT-style conversation simulator</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={runDemoFlow}
              disabled={!mcpConnected || isDemoRunning || isProcessing}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              {isDemoRunning ? "Running Demo..." : "Run Demo Flow"}
            </Button>
            <div
              className={cn(
                "flex items-center gap-2 text-xs px-3 py-1 rounded-full",
                mcpConnected
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              )}
            >
              <div className={cn("h-2 w-2 rounded-full", mcpConnected ? "bg-green-500" : "bg-red-500")} />
              <span>{mcpConnected ? "MCP Connected" : "MCP Disconnected"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {!mcpConnected && (
            <div className="text-center text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              ⚠️ MCP Server not connected - Check console for details
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onConfirm={handleConfirmRegistration}
              onProgramSelect={handleProgramSelect}
              onFormSubmit={handleFormSubmit}
            />
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-pulse">●</div>
                  <div className="animate-pulse delay-100">●</div>
                  <div className="animate-pulse delay-200">●</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t bg-card px-4 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex gap-3 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type your message... (Shift+Enter for new line)"
            className="min-h-[60px] resize-none"
            rows={2}
          />
          <Button
            onClick={handleSend}
            size="icon"
            className="h-[60px] w-[60px] shrink-0"
            disabled={!input.trim() || isProcessing}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Debug Panel */}
      <DebugPanel
        logs={debugLogs}
        isVisible={showDebugPanel}
        onToggle={() => setShowDebugPanel(!showDebugPanel)}
        onClear={() => setDebugLogs([])}
      />
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
}

interface MessageBubbleProps {
  message: Message;
  onConfirm?: () => void;
  onProgramSelect?: (program: any) => void;
  onFormSubmit?: (formId: string, values: any) => void;
}

function MessageBubble({ message, onConfirm, onProgramSelect, onFormSubmit }: MessageBubbleProps) {
  const isUser = message.sender === "user";

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-primary text-primary-foreground ml-auto"
            : "bg-muted text-foreground"
        )}
      >
        {/* Render markdown-style formatting */}
        <div 
          className="text-sm leading-relaxed whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ 
            __html: message.text
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
              .replace(/^• (.+)$/gm, '<li>$1</li>')
              .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
          }}
        />
        
        {/* Interactive Components */}
        {message.componentType === "confirmation" && message.componentData && onConfirm && (
          <ConfirmationCard
            title={message.componentData.title}
            message={message.componentData.message}
            onConfirm={onConfirm}
          />
        )}

        {message.componentType === "carousel" && message.componentData && onProgramSelect && (
          <OptionsCarousel
            options={message.componentData.options}
            onSelect={onProgramSelect}
          />
        )}

        {message.componentType === "form" && message.componentData && onFormSubmit && (
          <InlineChatForm
            title={message.componentData.title}
            fields={message.componentData.fields}
            onSubmit={(values) => onFormSubmit(message.id, values)}
          />
        )}

        {message.componentType === "status" && message.componentData && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.componentData.statuses.map((status: any, idx: number) => (
              <StatusChip
                key={idx}
                label={status.label}
                status={status.status}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
