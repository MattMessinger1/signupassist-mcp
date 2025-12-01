import { useState, useRef, useEffect } from "react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResponsibleDelegateForm } from "./chat-test/ResponsibleDelegateForm";
import { SavePaymentMethod } from "./SavePaymentMethod";
import { supabase } from "@/integrations/supabase/client";

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
  cta?: {
    buttons: Array<{
      label: string;
      action: string;
      variant?: "accent" | "outline";
      payload?: any;
    }>;
  };
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

interface MCPChatProps {
  mockUserId?: string;
  mockUserEmail?: string;
}

export function MCPChat({ mockUserId, mockUserEmail }: MCPChatProps = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(`lovable-test-${Date.now()}`);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [userTimezone, setUserTimezone] = useState<string>('UTC');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Detect user timezone on component mount
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setUserTimezone(detected);
      console.log('[MCPChat] User timezone detected:', detected);
    } catch (error) {
      console.warn('[MCPChat] Failed to detect timezone, using UTC:', error);
      setUserTimezone('UTC');
    }
  }, []);

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
      // Use mock user if provided, otherwise get authenticated user
      let userId: string | undefined;
      
      if (mockUserId) {
        userId = mockUserId;
        console.log('[MCPChat] Using mock user:', mockUserId);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id;
        console.log('[MCPChat] Using authenticated user:', userId);
      }
      
      const response = await sendMessage(userMessage, sessionId, undefined, undefined, undefined, undefined, undefined, userTimezone, userId);
      const assistantMessage = response.message || "(no response)";
      const assistantCards = response.cards || [];

      const ctaButtons = response.cta 
        ? (Array.isArray(response.cta) ? response.cta : (response.cta as any).buttons)
        : undefined;
      
      setMessages((prev) => [
        ...prev,
        { 
          role: "assistant", 
          content: assistantMessage,
          cards: assistantCards,
          cta: ctaButtons ? { buttons: ctaButtons } : undefined,
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
    console.log('[MCPChat] 🔍 Card action triggered:', {
      action,
      sessionId,
      payload,
      payload_type: typeof payload,
      payload_keys: payload ? Object.keys(payload) : [],
      has_program_data: !!payload?.program_data,
      program_data_keys: payload?.program_data ? Object.keys(payload.program_data) : [],
      stringified: JSON.stringify(payload, null, 2)
    });
    
    setLoading(true);
    
    try {
      // Use mock user if provided, otherwise get authenticated user
      let userId: string | undefined;
      
      if (mockUserId) {
        userId = mockUserId;
        console.log('[MCPChat] Using mock user for action:', mockUserId);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id;
        console.log('[MCPChat] Using authenticated user for action:', userId);
      }
      
      // Include user_id in payload for backend operations (esp. payment)
      const enrichedPayload = userId ? { ...payload, user_id: userId } : payload;
      
      const response = await sendAction(action, enrichedPayload, sessionId, undefined, userTimezone);
      
      const ctaButtons = response.cta 
        ? (Array.isArray(response.cta) ? response.cta : (response.cta as any).buttons)
        : undefined;
      
      setMessages((prev) => [
        ...prev,
        { 
          role: "assistant", 
          content: response.message || "(no response)",
          cards: response.cards || [],
          cta: ctaButtons ? { buttons: ctaButtons } : undefined,
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
      {/* Session Info & Auth Status */}
      <div className="flex items-center gap-2 px-2">
        <Badge variant="outline" className="text-xs">
          Session: {sessionId.slice(-8)}
        </Badge>
        {mockUserId ? (
          <Badge variant="default" className="text-xs">
            🔐 Mock User: {mockUserEmail}
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">
            🔓 Unauthenticated
          </Badge>
        )}
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

              {/* Render CTA Buttons */}
              {msg.cta && msg.cta.buttons && msg.cta.buttons.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 mr-12">
                  {msg.cta.buttons.map((button, btnIdx) => (
                    <Button
                      key={btnIdx}
                      variant={button.variant === "accent" ? "default" : "outline"}
                      size="default"
                      onClick={() => handleCardAction(button.action, button.payload || {})}
                      disabled={loading}
                      className={button.variant === "accent" ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}
                    >
                      {button.label}
                    </Button>
                  ))}
                </div>
              )}

              {/* Render Responsible Delegate Form */}
              {msg.metadata?.signupForm && (
                <ResponsibleDelegateForm
                  schema={msg.metadata.signupForm}
                  programTitle={msg.metadata.program_ref || "Selected Program"}
                  onSubmit={(data) => handleCardAction('submit_form', { formData: data })}
                />
              )}

              {/* Render Payment Setup Form */}
              {msg.metadata?.componentType === 'payment_setup' && (
                <div className="mt-4 mr-12">
                  <SavePaymentMethod
                    onPaymentMethodSaved={async () => {
                      console.log('[MCPChat] Payment method saved');
                      
                      // Get user info
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) {
                        toast({
                          title: "Error",
                          description: "User not authenticated",
                          variant: "destructive"
                        });
                        return;
                      }

                      // Get session token
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session) {
                        toast({
                          title: "Error",
                          description: "No active session",
                          variant: "destructive"
                        });
                        return;
                      }

                      // PART 4: Dynamic next action based on metadata
                      const nextAction = msg.metadata?.next_action;
                      console.log('[MCPChat] Next action from metadata:', nextAction);
                      
                      if (nextAction === 'confirm_payment') {
                        // Immediate registration - trigger booking directly
                        console.log('[MCPChat] Triggering immediate booking after payment setup');
                        await handleCardAction('confirm_payment', {
                          user_id: user.id,
                          ...msg.metadata?.schedulingData
                        });
                      } else if (nextAction === 'confirm_scheduled_registration') {
                        // Scheduled registration - existing Set & Forget flow
                        console.log('[MCPChat] Triggering scheduled registration after payment setup');
                        
                        // Get payment method from Stripe
                        const { data: billingData } = await supabase
                          .from('user_billing')
                          .select('default_payment_method_id')
                          .eq('user_id', user.id)
                          .maybeSingle();

                        const payment_method_id = billingData?.default_payment_method_id;
                        if (!payment_method_id) {
                          toast({
                            title: "Error",
                            description: "Payment method not found",
                            variant: "destructive"
                          });
                          return;
                        }

                        await handleCardAction('setup_payment_method', {
                          payment_method_id,
                          user_id: user.id,
                          email: user.email,
                          user_jwt: session.access_token,
                          schedulingData: msg.metadata?.schedulingData
                        });
                      } else {
                        console.warn('[MCPChat] Unknown next_action:', nextAction);
                      }
                    }}
                  />
                </div>
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
