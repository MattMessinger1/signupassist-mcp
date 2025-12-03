import { useState, useRef, useEffect } from "react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Send, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResponsibleDelegateForm } from "./chat-test/ResponsibleDelegateForm";
import { SavePaymentMethod } from "./SavePaymentMethod";
import { AuthGateModal } from "./AuthGateModal";
import { supabase } from "@/integrations/supabase/client";

interface SavedChild {
  id: string;
  first_name: string;
  last_name: string;
  dob?: string;
}

interface SavedPaymentMethod {
  has_payment_method: boolean;
  last4?: string;
  brand?: string;
}

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
  mockUserFirstName?: string;
  mockUserLastName?: string;
  forceUnauthenticated?: boolean;  // When true, treat as unauthenticated regardless of Supabase session
}

export function MCPChat({ mockUserId, mockUserEmail, mockUserFirstName, mockUserLastName, forceUnauthenticated }: MCPChatProps = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(`lovable-test-${Date.now()}`);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [userTimezone, setUserTimezone] = useState<string>('UTC');
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [pendingPaymentMetadata, setPendingPaymentMetadata] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [hasCompletedAuthGate, setHasCompletedAuthGate] = useState(false);
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<number>>(new Set());
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<{
    email?: string;
    firstName?: string;
    lastName?: string;
  } | null>(null);
  const [savedChildren, setSavedChildren] = useState<SavedChild[]>([]);
  const [savedPaymentMethod, setSavedPaymentMethod] = useState<SavedPaymentMethod | null>(null);
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

  // Load authenticated user data for form pre-population
  useEffect(() => {
    const loadUserData = async () => {
      if (mockUserId && mockUserEmail) {
        // For mock users, use mock email and name
        setAuthenticatedUser({ 
          email: mockUserEmail,
          firstName: mockUserFirstName,
          lastName: mockUserLastName
        });
        console.log('[MCPChat] Using mock user data:', mockUserEmail, mockUserFirstName, mockUserLastName);
      } else if (!forceUnauthenticated) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setAuthenticatedUser({
            email: user.email,
            firstName: user.user_metadata?.first_name,
            lastName: user.user_metadata?.last_name
          });
          console.log('[MCPChat] Loaded authenticated user data:', user.email);
        }
      }
    };
    loadUserData();
  }, [mockUserId, mockUserEmail, mockUserFirstName, mockUserLastName, forceUnauthenticated, isAuthenticated]);

  // Load saved children and payment method for authenticated users (MCP compliant)
  useEffect(() => {
    const loadSavedUserData = async () => {
      const userId = mockUserId || (forceUnauthenticated ? undefined : (await supabase.auth.getUser()).data.user?.id);
      
      if (!userId) {
        console.log('[MCPChat] No user ID - skipping saved data load');
        setSavedChildren([]);
        setSavedPaymentMethod(null);
        return;
      }
      
      console.log('[MCPChat] Loading saved children and payment method for user:', userId);
      
      try {
        // Load saved children via MCP tool (sends to orchestrator endpoint)
        const childrenResponse = await sendAction('load_saved_children', { user_id: userId }, sessionId, undefined, userTimezone);
        if (childrenResponse.metadata?.savedChildren) {
          setSavedChildren(childrenResponse.metadata.savedChildren);
          console.log('[MCPChat] Loaded saved children:', childrenResponse.metadata.savedChildren.length);
        }
        
        // Load payment method via MCP tool
        const paymentResponse = await sendAction('check_payment_method', { user_id: userId }, sessionId, undefined, userTimezone);
        if (paymentResponse.metadata?.paymentMethod) {
          setSavedPaymentMethod(paymentResponse.metadata.paymentMethod);
          console.log('[MCPChat] Loaded saved payment method:', paymentResponse.metadata.paymentMethod);
        }
      } catch (error) {
        console.error('[MCPChat] Error loading saved user data:', error);
        // Non-fatal - continue without saved data
      }
    };
    
    // Only load when authenticated and session is ready
    if (isAuthenticated || mockUserId) {
      loadSavedUserData();
    }
  }, [isAuthenticated, mockUserId, forceUnauthenticated, sessionId, userTimezone]);

  // Check authentication status when payment setup is triggered
  useEffect(() => {
    const checkAuth = async () => {
      // If user already completed auth gate, skip re-checking
      if (hasCompletedAuthGate) {
        console.log('[MCPChat] Auth gate already completed - staying authenticated');
        return;  // Don't re-run auth checks
      }
      
      // If force unauthenticated mode, don't check real auth
      if (forceUnauthenticated && !mockUserId) {
        console.log('[MCPChat] Force unauthenticated mode - bypassing Supabase auth');
        setIsAuthenticated(false);
        
        // Show auth gate if payment setup is pending
        const hasPaymentSetupPending = messages.some(
          msg => msg.metadata?.componentType === 'payment_setup'
        );
        
        if (hasPaymentSetupPending) {
          const paymentMsg = messages.find(msg => msg.metadata?.componentType === 'payment_setup');
          if (paymentMsg) {
            console.log('[MCPChat] Payment setup detected for unauthenticated user - showing auth gate');
            setPendingPaymentMetadata(paymentMsg.metadata);
            setShowAuthGate(true);
          }
        }
        return;
      }
      
      if (mockUserId) {
        setIsAuthenticated(true);
        return;
      }
      
      // Real auth check only when not in force-unauthenticated mode
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
      
      // If payment setup is pending and user is not authenticated, show auth gate
      const hasPaymentSetupPending = messages.some(
        msg => msg.metadata?.componentType === 'payment_setup'
      );
      
      if (hasPaymentSetupPending && !user) {
        const paymentMsg = messages.find(msg => msg.metadata?.componentType === 'payment_setup');
        if (paymentMsg) {
          console.log('[MCPChat] Payment setup detected for unauthenticated user - showing auth gate');
          setPendingPaymentMetadata(paymentMsg.metadata);
          setShowAuthGate(true);
        }
      }
    };
    
    checkAuth();
  }, [messages, mockUserId, forceUnauthenticated, hasCompletedAuthGate]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    // Use setTimeout to wait for DOM to update
    const timer = setTimeout(() => {
      if (scrollRef.current) {
        // Scroll the last child into view instead of manipulating scrollTop
        const lastChild = scrollRef.current.lastElementChild;
        if (lastChild) {
          lastChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [messages, loading]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[MCPChat] Auth state changed:', event, session?.user?.id);
      
      if (event === 'SIGNED_IN' && pendingPaymentMetadata) {
        console.log('[MCPChat] User signed in, continuing with pending payment');
        setShowAuthGate(false);
        setHasCompletedAuthGate(true);  // Mark that user completed auth gate
        setIsAuthenticated(true);       // Explicitly set authenticated
        
        // Add a message showing the payment form now that user is authenticated
        setMessages((prev) => [
          ...prev,
          { 
            role: "assistant", 
            content: "✅ Account created! Now let's set up your payment method.",
            metadata: pendingPaymentMetadata
          },
        ]);
        
        setPendingPaymentMetadata(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [pendingPaymentMetadata]);

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
      } else if (forceUnauthenticated) {
        // Truly unauthenticated - don't get real user
        userId = undefined;
        console.log('[MCPChat] Force unauthenticated - no user_id');
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
      } else if (forceUnauthenticated) {
        // Truly unauthenticated - don't get real user
        userId = undefined;
        console.log('[MCPChat] Force unauthenticated - no user_id for action');
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

              {/* Render Fullscreen Form (ChatGPT Compliance) */}
              {msg.metadata?.componentType === 'fullscreen_form' && !submittedFormIds.has(idx) && (
                <Sheet open={true} onOpenChange={(open) => {
                  if (!open) {
                    // Allow closing - mark as submitted so it doesn't reopen
                    setSubmittedFormIds(prev => new Set(prev).add(idx));
                  }
                }}>
                  <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
                    <SheetHeader className="flex flex-row items-center justify-between">
                      <div>
                        <SheetTitle>{msg.metadata.program_name || "Registration Form"}</SheetTitle>
                        <SheetDescription>
                          Complete the form below to continue with your registration.
                        </SheetDescription>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setSubmittedFormIds(prev => new Set(prev).add(idx))}
                      >
                        ← Go Back
                      </Button>
                    </SheetHeader>
                    <div className="mt-6">
                      <ResponsibleDelegateForm
                        schema={msg.metadata.signupForm}
                        programTitle={msg.metadata.program_ref || "Selected Program"}
                        initialDelegateData={authenticatedUser ? {
                          delegate_email: authenticatedUser.email,
                          delegate_firstName: authenticatedUser.firstName,
                          delegate_lastName: authenticatedUser.lastName
                        } : undefined}
                        savedChildren={savedChildren}
                        onSubmit={(data) => {
                          // Mark this form as submitted
                          setSubmittedFormIds(prev => new Set(prev).add(idx));
                          
                          // If user wants to save new participants, include in payload
                          const payload: any = { formData: data };
                          if (data.saveNewChildren && data.saveNewChildren.length > 0) {
                            payload.saveNewChildren = data.saveNewChildren;
                          }
                          
                          handleCardAction('submit_form', payload);
                        }}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              )}
              
              {/* Legacy inline form - kept for backward compatibility */}
              {msg.metadata?.signupForm && !msg.metadata?.componentType && !submittedFormIds.has(idx) && (
                <ResponsibleDelegateForm
                  schema={msg.metadata.signupForm}
                  programTitle={msg.metadata.program_ref || "Selected Program"}
                  onSubmit={(data) => {
                    // Mark this form as submitted
                    setSubmittedFormIds(prev => new Set(prev).add(idx));
                    handleCardAction('submit_form', { formData: data });
                  }}
                />
              )}

              {/* Show payment setup indicator in message */}
              {msg.metadata?.componentType === 'payment_setup' && (
                <Badge variant="secondary" className="mt-2">
                  💳 Payment setup in progress...
                </Badge>
              )}
            </div>
          ))}

          {/* Single Payment Setup Form (ChatGPT Compliance - only one CardElement allowed) */}
          {(() => {
            const lastPaymentMessage = messages
              .slice()
              .reverse()
              .find(msg => msg.metadata?.componentType === 'payment_setup');
            
            console.log('[MCPChat] Payment form render check:', {
              hasPaymentMessage: !!lastPaymentMessage,
              isAuthenticated,
              paymentCompleted,
              forceUnauthenticated,
              shouldShowForm: !!(lastPaymentMessage && isAuthenticated && !paymentCompleted)
            });
            
            return lastPaymentMessage && isAuthenticated && !paymentCompleted && (
              <div className="mt-4 mr-12">
                <SavePaymentMethod
                  mockUserId={mockUserId}
                  mockUserEmail={mockUserEmail}
                  onPaymentMethodSaved={async () => {
                    console.log('[MCPChat] Payment method saved');
                    setPaymentCompleted(true);
                    
                    // Get user info (use mock if provided)
                    let userId: string | undefined;
                    let userEmail: string | undefined;
                    
                    if (mockUserId && mockUserEmail) {
                      userId = mockUserId;
                      userEmail = mockUserEmail;
                      console.log('[MCPChat] Using mock user for payment callback:', userId);
                    } else {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) {
                        toast({
                          title: "Error",
                          description: "User not authenticated",
                          variant: "destructive"
                        });
                        return;
                      }
                      userId = user.id;
                      userEmail = user.email!;
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
                    const nextAction = lastPaymentMessage.metadata?.next_action;
                    console.log('[MCPChat] Next action from metadata:', nextAction);
                    if (nextAction === 'confirm_payment') {
                      // Immediate registration - trigger booking directly
                      console.log('[MCPChat] Triggering immediate booking after payment setup');
                      await handleCardAction('confirm_payment', {
                        user_id: userId,
                        ...lastPaymentMessage.metadata?.schedulingData
                      });
                    } else if (nextAction === 'confirm_scheduled_registration') {
                      // Scheduled registration - existing Set & Forget flow
                      console.log('[MCPChat] Triggering scheduled registration after payment setup');
                      
                      // Get payment method from Stripe
                      const { data: billingData } = await supabase
                        .from('user_billing')
                        .select('default_payment_method_id')
                        .eq('user_id', userId)
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

                      // Get session token (only if real user, not mock)
                      let accessToken: string | undefined;
                      if (!mockUserId) {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) {
                          toast({
                            title: "Error",
                            description: "No active session",
                            variant: "destructive"
                          });
                          return;
                        }
                        accessToken = session.access_token;
                      }

                      await handleCardAction('setup_payment_method', {
                        payment_method_id,
                        user_id: userId,
                        email: userEmail,
                        user_jwt: accessToken,
                        schedulingData: lastPaymentMessage.metadata?.schedulingData
                      });
                    } else {
                      console.warn('[MCPChat] Unknown next_action:', nextAction);
                    }
                  }}
                />
              </div>
            );
          })()}
          
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

      {/* Auth Gate Modal */}
      <AuthGateModal 
        isOpen={showAuthGate}
        onClose={() => setShowAuthGate(false)}
        onAuthSuccess={() => {
          console.log('[MCPChat] Auth success callback triggered');
          // The auth state change listener will handle continuing the flow
        }}
        delegateEmail={pendingPaymentMetadata?.schedulingData?.formData?.delegate_data?.delegate_email}
      />

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
