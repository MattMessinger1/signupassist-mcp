import { useState, useRef, useEffect } from "react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CardData {
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{
    label: string;
    action: string;
    variant?: "accent" | "outline";
    payload?: any;
  }>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: CardData[];
  metadata?: {
    signupForm?: Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
      options?: Array<{ value: string; label: string }>;
    }>;
    [key: string]: any;
  };
}

export function MCPChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(`lovable-test-${Date.now()}`);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

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
          cards: assistantCards,
          metadata: response.metadata
        },
      ]);
    } catch (error) {
      console.error("MCP Chat error:", error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      toast({
        title: "❌ Message Failed",
        description: errorMsg,
        variant: "destructive",
      });
      
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${errorMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCardAction(action: string, payload: any) {
    console.log('[MCPChat] Card action triggered:', {
      action,
      payload,
      payload_type: typeof payload,
      payload_keys: payload ? Object.keys(payload) : [],
      has_program_data: !!payload?.program_data,
      program_data_keys: payload?.program_data ? Object.keys(payload.program_data) : [],
      stringified: JSON.stringify(payload, null, 2)
    });
    
    setLoading(true);
    
    try {
      const response = await sendAction(action, payload, sessionId);
      
      setMessages((prev) => [
        ...prev,
        { 
          role: "assistant", 
          content: response.message || "(no response)",
          cards: response.cards || [],
          metadata: response.metadata
        },
      ]);
    } catch (error) {
      console.error("Card action error:", error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      toast({
        title: "❌ Action Failed",
        description: errorMsg,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[600px] gap-4">
      {/* Session Info */}
      <div className="flex items-center gap-2 px-2">
        <Badge variant="outline" className="text-xs">
          Session: {sessionId.slice(-8)}
        </Badge>
        {loading && (
          <Badge variant="secondary" className="text-xs">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Processing...
          </Badge>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 border rounded-lg">
        <div ref={scrollRef} className="p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-[400px] text-muted-foreground">
              <div className="text-center space-y-2">
                <p className="text-lg font-semibold">Welcome to MCP Chat Test</p>
                <p className="text-sm">Send a message to start testing the orchestrator</p>
              </div>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx}>
              <Card className={`p-4 ${msg.role === "user" ? "bg-primary/10 ml-12" : "bg-secondary/10 mr-12"}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={msg.role === "user" ? "default" : "secondary"} className="text-xs">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </Badge>
                </div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              </Card>
              
              {msg.cards && msg.cards.length > 0 && (
                <div className="grid grid-cols-1 gap-3 mt-3 mr-12">
                  {msg.cards.map((card, cardIdx) => (
                    <Card key={cardIdx} className="p-4 bg-accent/5 border-accent/20 hover:bg-accent/10 transition-colors">
                      <div className="space-y-2">
                        <div className="font-semibold">{card.title}</div>
                        {card.subtitle && (
                          <div className="text-sm text-muted-foreground">{card.subtitle}</div>
                        )}
                        {card.description && (
                          <div className="text-sm text-muted-foreground">{card.description}</div>
                        )}
                        {card.metadata && (
                          <div className="flex flex-wrap gap-2 text-xs">
                            {card.metadata.orgRef && (
                              <Badge variant="outline">Org: {card.metadata.orgRef}</Badge>
                            )}
                            {card.metadata.location && (
                              <Badge variant="outline">📍 {card.metadata.location}</Badge>
                            )}
                            {card.metadata.category && (
                              <Badge variant="outline">{card.metadata.category}</Badge>
                            )}
                          </div>
                        )}
                        {card.buttons && card.buttons.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {card.buttons.map((button, btnIdx) => (
                              <Button
                                key={btnIdx}
                                variant={button.variant === "accent" ? "default" : "outline"}
                                size="sm"
                                onClick={() => handleCardAction(button.action, button.payload || {})}
                                disabled={loading}
                              >
                                {button.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {msg.metadata?.signupForm && (
                <Card className="p-4 mt-3 mr-12 bg-card">
                  <div className="space-y-4">
                    <div className="font-semibold">Registration Form</div>
                    {msg.metadata.signupForm.map((field: any, fieldIdx: number) => (
                      <div key={fieldIdx} className="space-y-2">
                        <label className="text-sm font-medium">
                          {field.label}
                          {field.required && <span className="text-destructive ml-1">*</span>}
                        </label>
                        {field.type === 'select' ? (
                          <select
                            className="w-full p-2 border rounded-md bg-background"
                            value={formData[field.name] || ''}
                            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                          >
                            <option value="">Select...</option>
                            {field.options?.map((opt: any, optIdx: number) => (
                              <option key={optIdx} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            className="w-full p-2 border rounded-md bg-background"
                            rows={3}
                            value={formData[field.name] || ''}
                            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                          />
                        ) : (
                          <Input
                            type={field.type || 'text'}
                            value={formData[field.name] || ''}
                            onChange={(e) => setFormData({ ...formData, [field.name]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                    <Button
                      onClick={() => {
                        handleCardAction('submit_registration', formData);
                        setFormData({});
                      }}
                      disabled={loading}
                      className="w-full"
                    >
                      Submit Registration
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          ))}
          
          {loading && (
            <Card className="p-4 bg-secondary/10 mr-12">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary" className="text-xs">Assistant</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="flex gap-2">
        <Input
          placeholder="Type a message to test the MCP orchestrator..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={loading}
          className="flex-1"
        />
        <Button 
          onClick={() => send(input)} 
          disabled={loading || !input.trim()}
          size="icon"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
