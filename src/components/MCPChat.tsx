import { useState } from "react";
import { sendMessage } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Card {
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: "accent" | "outline";
  }>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: Card[];
}

export function MCPChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(`lovable-test-${Date.now()}`);

  async function send(userMessage: string) {
    if (!userMessage.trim() || loading) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
    ]);
    setInput("");
    setLoading(true);

    try {
      const response = await sendMessage(userMessage, sessionId);
      const assistantMessage = response.message || "(no response)";
      const assistantCards = response.cards || [];

      setMessages((prev) => [
        ...prev,
        { 
          role: "assistant", 
          content: assistantMessage,
          cards: assistantCards
        },
      ]);
    } catch (error) {
      console.error("MCP Chat error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[600px] gap-4">
      <ScrollArea className="flex-1 p-4 border rounded-lg">
        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx}>
              <Card className={`p-3 ${msg.role === "user" ? "bg-primary/10 ml-12" : "bg-secondary/10 mr-12"}`}>
                <div className="font-semibold text-sm mb-1">
                  {msg.role === "user" ? "You" : "Assistant"}
                </div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              </Card>
              
              {msg.cards && msg.cards.length > 0 && (
                <div className="grid grid-cols-1 gap-2 mt-2 mr-12">
                  {msg.cards.map((card, cardIdx) => (
                    <Card key={cardIdx} className="p-3 bg-accent/5 border-accent/20">
                      <div className="font-semibold text-sm mb-1">{card.title}</div>
                      {card.subtitle && (
                        <div className="text-xs text-muted-foreground mb-2">{card.subtitle}</div>
                      )}
                      {card.description && (
                        <div className="text-xs text-muted-foreground">{card.description}</div>
                      )}
                      {card.metadata && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {card.metadata.orgRef && <div>Org: {card.metadata.orgRef}</div>}
                          {card.metadata.location && <div>Location: {card.metadata.location}</div>}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <Card className="p-3 bg-secondary/10 mr-12">
              <div className="font-semibold text-sm mb-1">Assistant</div>
              <div className="text-sm">Thinking...</div>
            </Card>
          )}
        </div>
      </ScrollArea>

      <div className="flex gap-2">
        <Input
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={loading}
        />
        <Button onClick={() => send(input)} disabled={loading || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
