import { useState } from "react";
import { sendMessage } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant";
  content: string;
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

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: assistantMessage },
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
            <Card key={idx} className={`p-3 ${msg.role === "user" ? "bg-primary/10 ml-12" : "bg-secondary/10 mr-12"}`}>
              <div className="font-semibold text-sm mb-1">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
            </Card>
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
