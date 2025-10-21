import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  payload?: any; // For future interactive elements (cards, buttons, etc.)
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
      text: "Hi, I need help signing up my child for a class.",
      timestamp: new Date(),
    },
    {
      id: "3",
      sender: "assistant",
      text: "Sure, I can help with that! Let's begin the sign-up process. Which program or provider are you interested in?",
      timestamp: new Date(),
    },
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
        {/* Placeholder for future interactive elements */}
        {message.payload && (
          <div className="mt-3 pt-3 border-t border-border/50">
            {/* Interactive cards/buttons will be rendered here */}
            <div className="text-xs opacity-70">
              [Interactive element placeholder]
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
