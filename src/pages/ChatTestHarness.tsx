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
import { initializeMCP, callMCPTool, mcpLogin, mcpFindPrograms, mcpCheckPrerequisites } from "@/lib/chatMcpClient";
import { useToast } from "@/hooks/use-toast";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize MCP connection on mount
  useEffect(() => {
    initializeMCP().then((connected) => {
      setMcpConnected(connected);
      if (!connected) {
        addAssistantMessage(
          "⚠️ Warning: MCP server connection failed. Make sure the server is running and VITE_MCP_BASE_URL is configured."
        );
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
  };

  const handleError = (error: string) => {
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
      const result = await mcpFindPrograms(state.orgRef || "blackhawk-ski-club", query);

      if (!result.success) {
        handleError(result.error || "Failed to search programs");
        return;
      }

      // Mock programs for now - in real implementation, parse result.data
      const programs = [
        { id: "ski-l1", title: "Ski Lessons - Level 1", description: "Beginner slopes, Ages 6-10" },
        { id: "ski-l2", title: "Ski Lessons - Level 2", description: "Intermediate, Ages 8-14" },
        { id: "snowboard-101", title: "Snowboarding 101", description: "Beginner course, Ages 10+" },
      ];

      addAssistantMessage(
        "I found these programs that match your search. Please select one:",
        "carousel",
        { options: programs }
      );
    } catch (error) {
      handleError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProgramSelect = async (program: any) => {
    console.log("[Chat] Program selected:", program);
    setState({ ...state, selectedProgram: program });

    addUserMessage(`I'll take ${program.title}`);
    setIsProcessing(true);

    try {
      // Check prerequisites for this program
      const prereqResult = await mcpCheckPrerequisites(
        state.orgRef || "blackhawk-ski-club",
        program.id
      );

      if (!prereqResult.success) {
        handleError(prereqResult.error || "Failed to check prerequisites");
        return;
      }

      // Show confirmation card
      addAssistantMessage(
        "Perfect! Please review and confirm your selection:",
        "confirmation",
        {
          title: "Confirm Registration",
          message: `Program: ${program.title}\n${program.description}\nPrice: $120`,
        }
      );
    } catch (error) {
      handleError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRegistration = async () => {
    console.log("[Chat] Registration confirmed");
    addUserMessage("Confirmed!");

    setIsProcessing(true);

    try {
      // Check prerequisites
      const prereqResult = await mcpCheckPrerequisites(state.orgRef || "blackhawk-ski-club");

      if (!prereqResult.success) {
        handleError(prereqResult.error || "Failed to check prerequisites");
        return;
      }

      // Mock prerequisite statuses
      const prereqStatuses = [
        { label: "Account Login", status: state.sessionRef ? "done" : "pending" },
        { label: "Waiver Signed", status: "pending" },
        { label: "Payment Info", status: "pending" },
        { label: "Emergency Contact", status: "pending" },
      ];

      addAssistantMessage(
        "Great! Let's check your prerequisites:",
        "status",
        { statuses: prereqStatuses }
      );

      // If not logged in, prompt for login
      if (!state.sessionRef) {
        setTimeout(() => {
          addAssistantMessage(
            "I need your login credentials to proceed. Please fill out this form:",
            "form",
            {
              title: "Login Required",
              fields: [
                { id: "email", label: "Email", type: "text", required: true },
                { id: "password", label: "Password", type: "text", required: true },
              ],
            }
          );
        }, 1000);
      } else {
        // If logged in, ask for additional info
        setTimeout(() => {
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
        }, 1000);
      }
    } catch (error) {
      handleError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFormSubmit = async (formId: string, values: Record<string, any>) => {
    console.log("[Chat] Form submitted:", formId, values);

    setIsProcessing(true);

    try {
      // If this is a login form
      if (values.email && values.password) {
        addUserMessage("Logging in...");

        const loginResult = await mcpLogin(
          values.email,
          values.password,
          state.orgRef || "blackhawk-ski-club"
        );

        if (!loginResult.success) {
          handleError(loginResult.error || "Login failed");
          return;
        }

        setState({ ...state, sessionRef: loginResult.session_ref });

        addAssistantMessage("✅ Login successful! You're now connected.");

        // After successful login, proceed to next step
        setTimeout(() => {
          addAssistantMessage(
            "Now, please provide additional information:",
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
        }, 1000);
      }
      // If this is registration details form
      else if (values.childName) {
        addUserMessage("Submitting registration...");

        // In real implementation, call mcpRegister with actual session and program data
        addAssistantMessage(
          `✅ Registration submitted successfully!\n\nChild Name: ${values.childName}\nEmergency Contact: ${values.emergencyContact}\n\nYou'll receive a confirmation email shortly.`
        );

        toast({
          title: "Success",
          description: "Registration completed!",
        });
      }
    } catch (error) {
      handleError(error instanceof Error ? error.message : "Unknown error");
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

      toast({
        title: "Demo Complete",
        description: "Automated signup flow finished successfully!",
      });

    } catch (error) {
      console.error("[Demo] Error during flow:", error);
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
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
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
      <div className="border-t bg-card px-4 py-4">
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
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
        
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
