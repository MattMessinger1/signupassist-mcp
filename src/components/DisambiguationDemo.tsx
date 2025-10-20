import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatMessageCard } from "./ChatMessageCard";
import { useProviderDisambiguation } from "@/hooks/useProviderDisambiguation";
import { ChatMessage } from "@/types/chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send } from "lucide-react";

export function DisambiguationDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const { handleSingleMatch, handleConfirmation, handleTextFallback, context } = useProviderDisambiguation();

  const simulateSingleMatch = () => {
    const assistantMsg = handleSingleMatch(
      {
        name: "Blackhawk Ski Club",
        city: "Middleton, WI",
        address: "123 Ski Lane, Middleton, WI 53562",
        orgRef: "blackhawk-ski",
      },
      "Blackhawk Ski Club"
    );
    
    setMessages(prev => [...prev, assistantMsg]);
  };

  const handleCardConfirm = (data: any) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user" as const,
      content: "Yes, that's it",
      timestamp: new Date(),
    };

    const assistantMsg = handleConfirmation(true, data);
    setMessages(prev => [...prev, userMsg, assistantMsg]);
  };

  const handleCardReject = (data: any) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user" as const,
      content: "Not this one",
      timestamp: new Date(),
    };

    const assistantMsg = handleConfirmation(false, data);
    setMessages(prev => [...prev, userMsg, assistantMsg]);
  };

  const handleSendMessage = () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user" as const,
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);

    // Check if this is a text fallback response
    if (context?.type === "single_match") {
      const isAffirmative = handleTextFallback(input, "confirm");
      const isNegative = handleTextFallback(input, "reject");

      if (isAffirmative && context.providers?.[0]) {
        const assistantMsg = handleConfirmation(true, context.providers[0]);
        setMessages(prev => [...prev, assistantMsg]);
      } else if (isNegative) {
        const assistantMsg = handleConfirmation(false, {});
        setMessages(prev => [...prev, assistantMsg]);
      }
    }

    setInput("");
  };

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Provider Disambiguation Demo</CardTitle>
          <CardDescription>
            Testing Case 1: Single Match Found with card confirmation and text fallback
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={simulateSingleMatch} variant="outline" className="w-full">
            Simulate Single Match Found
          </Button>

          <ScrollArea className="h-[400px] rounded-lg border bg-muted/20 p-4">
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border"
                    }`}
                  >
                    <div className="prose prose-sm dark:prose-invert">
                      {msg.content.split('\n').map((line, i) => (
                        <p key={i} className="mb-1 last:mb-0">
                          {line.split('**').map((part, j) => 
                            j % 2 === 0 ? part : <strong key={j}>{part}</strong>
                          )}
                        </p>
                      ))}
                    </div>
                    
                    {msg.card && (
                      <div className="mt-3">
                        <ChatMessageCard
                          card={msg.card}
                          onConfirm={handleCardConfirm}
                          onReject={handleCardReject}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Type your response or use the card buttons..."
            />
            <Button onClick={handleSendMessage} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Try typing "yes", "that's it", "no", or "not sure" to test text fallback handling
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
