import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ConfirmationCard } from "@/components/chat-test/ConfirmationCard";
import { OptionsCarousel } from "@/components/chat-test/OptionsCarousel";
import { InlineChatForm } from "@/components/chat-test/InlineChatForm";
import { StatusChip } from "@/components/chat-test/StatusChip";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  componentType?: "confirmation" | "carousel" | "form" | "status";
  componentData?: any;
}

export default function ChatTestHarness() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "assistant",
      text: "Hello! I can assist you with program sign-ups. How can I help today?",
      timestamp: new Date(),
    },
    {
      id: "2",
      sender: "user",
      text: "Hi, I need help signing up my child for ski lessons.",
      timestamp: new Date(),
    },
    {
      id: "3",
      sender: "assistant",
      text: "Great! Here are 3 ski programs that match your search. Please select one:",
      timestamp: new Date(),
      componentType: "carousel",
      componentData: {
        options: [
          { id: "1", title: "Ski Lessons - Level 1", description: "Beginner slopes, Ages 6-10" },
          { id: "2", title: "Ski Lessons - Level 2", description: "Intermediate, Ages 8-14" },
          { id: "3", title: "Snowboarding 101", description: "Beginner course, Ages 10+" }
        ]
      }
    },
    {
      id: "4",
      sender: "user",
      text: "I'll take Ski Lessons - Level 1",
      timestamp: new Date(),
    },
    {
      id: "5",
      sender: "assistant",
      text: "Perfect! You are about to sign up for Ski Lessons - Level 1 on January 5, 2025. Please confirm to continue:",
      timestamp: new Date(),
      componentType: "confirmation",
      componentData: {
        title: "Confirm Registration",
        message: "Program: Ski Lessons - Level 1\nDate: January 5, 2025\nPrice: $120"
      }
    },
    {
      id: "6",
      sender: "user",
      text: "Confirmed!",
      timestamp: new Date(),
    },
    {
      id: "7",
      sender: "assistant",
      text: "Excellent! Before we proceed, let's check your prerequisites:",
      timestamp: new Date(),
      componentType: "status",
      componentData: {
        statuses: [
          { label: "Waiver Signed", status: "done" },
          { label: "Payment Info", status: "pending" },
          { label: "Emergency Contact", status: "pending" }
        ]
      }
    },
    {
      id: "8",
      sender: "assistant",
      text: "I need a bit more information to complete your registration. Please fill out this form:",
      timestamp: new Date(),
      componentType: "form",
      componentData: {
        title: "Additional Information",
        fields: [
          { id: "childName", label: "Child's Full Name", type: "text", required: true },
          { id: "emergencyContact", label: "Emergency Contact Phone", type: "text", required: true },
          { id: "waiver", label: "I agree to the terms and waiver", type: "checkbox", required: true }
        ]
      }
    }
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput("");

    // Simulate assistant response (placeholder for future backend integration)
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: "assistant",
        text: "I received your message. (This is a placeholder response - backend integration coming soon)",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">SignupAssist Test Harness</h1>
        <p className="text-sm text-muted-foreground">ChatGPT-style conversation simulator</p>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
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
            disabled={!input.trim()}
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

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.sender === "user";

  const handleConfirm = () => {
    console.log("Confirmed:", message.componentData);
  };

  const handleCancel = () => {
    console.log("Cancelled:", message.componentData);
  };

  const handleOptionSelect = (option: any) => {
    console.log("Selected option:", option);
  };

  const handleFormSubmit = (values: any) => {
    console.log("Form submitted:", values);
  };

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
        {message.componentType === "confirmation" && message.componentData && (
          <ConfirmationCard
            title={message.componentData.title}
            message={message.componentData.message}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        )}

        {message.componentType === "carousel" && message.componentData && (
          <OptionsCarousel
            options={message.componentData.options}
            onSelect={handleOptionSelect}
          />
        )}

        {message.componentType === "form" && message.componentData && (
          <InlineChatForm
            title={message.componentData.title}
            fields={message.componentData.fields}
            onSubmit={handleFormSubmit}
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
