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
import { FeeBreakdown } from "./FeeBreakdown";
import { TrustCallout } from "./TrustCallout";
import { COPY } from "@/copy/signupassistCopy";
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

interface DelegateProfile {
  delegate_dob?: string;
  delegate_relationship?: string;
  delegate_phone?: string;
  delegate_firstName?: string;
  delegate_lastName?: string;
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
  // New auth-first pattern props
  authenticatedUser?: { id: string; email?: string | null } | null;
  requireAuth?: boolean;
  
  // Legacy props (deprecated - kept for backward compatibility)
  mockUserId?: string;
  mockUserEmail?: string;
  mockUserFirstName?: string;
  mockUserLastName?: string;
  forceUnauthenticated?: boolean;
}

export function MCPChat({ 
  authenticatedUser: authenticatedUserProp,
  requireAuth = false,
  mockUserId, 
  mockUserEmail, 
  mockUserFirstName, 
  mockUserLastName, 
  forceUnauthenticated 
}: MCPChatProps = {}) {
  // Derive user ID and email from authenticatedUser (auth-first) or legacy mock props
  const effectiveUserId = authenticatedUserProp?.id || mockUserId;
  const effectiveUserEmail = authenticatedUserProp?.email || mockUserEmail;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(`lovable-test-${Date.now()}`);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [userTimezone, setUserTimezone] = useState<string>('UTC');
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [pendingPaymentMetadata, setPendingPaymentMetadata] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!authenticatedUserProp);
  const [hasCompletedAuthGate, setHasCompletedAuthGate] = useState(false);
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<number>>(new Set());
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const [userFormData, setUserFormData] = useState<{
    email?: string;
    firstName?: string;
    lastName?: string;
  } | null>(null);
  const [savedChildren, setSavedChildren] = useState<SavedChild[]>([]);
  const [savedPaymentMethod, setSavedPaymentMethod] = useState<SavedPaymentMethod | null>(null);
  const [delegateProfile, setDelegateProfile] = useState<DelegateProfile | null>(null);
  const [pendingProtectedAction, setPendingProtectedAction] = useState<{
    action: string;
    payload: any;
  } | null>(null);
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
      if (effectiveUserId && effectiveUserEmail) {
        // For auth-first or mock users, use provided email and name
        setUserFormData({ 
          email: effectiveUserEmail,
          firstName: mockUserFirstName,
          lastName: mockUserLastName
        });
        console.log('[MCPChat] Using user data:', effectiveUserEmail, mockUserFirstName, mockUserLastName);
      } else if (!forceUnauthenticated && !requireAuth) {
        // Legacy mode: fetch from Supabase directly
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserFormData({
            email: user.email,
            firstName: user.user_metadata?.first_name,
            lastName: user.user_metadata?.last_name
          });
          console.log('[MCPChat] Loaded authenticated user data:', user.email);
        }
      }
    };
    loadUserData();
  }, [effectiveUserId, effectiveUserEmail, mockUserFirstName, mockUserLastName, forceUnauthenticated, isAuthenticated, requireAuth]);

  // Load saved children, payment method, and delegate profile for authenticated users (MCP compliant)
  useEffect(() => {
    const loadSavedUserData = async () => {
      // Use effectiveUserId from auth-first pattern, or fallback to Supabase lookup
      let userId = effectiveUserId;
      if (!userId && !forceUnauthenticated && !requireAuth) {
        userId = (await supabase.auth.getUser()).data.user?.id;
      }
      
      if (!userId) {
        console.log('[MCPChat] No user ID - skipping saved data load');
        setSavedChildren([]);
        setSavedPaymentMethod(null);
        setDelegateProfile(null);
        return;
      }
      
      console.log('[MCPChat] Loading saved data for user:', userId);
      
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
        
        // Load delegate profile via MCP tool
        const profileResponse = await sendAction('load_delegate_profile', { user_id: userId }, sessionId, undefined, userTimezone);
        if (profileResponse.metadata?.delegateProfile) {
          const profile = profileResponse.metadata.delegateProfile;
          setDelegateProfile({
            delegate_dob: profile.date_of_birth,
            delegate_relationship: profile.default_relationship,
            delegate_phone: profile.phone,
            delegate_firstName: profile.first_name,
            delegate_lastName: profile.last_name
          });
          console.log('[MCPChat] Loaded delegate profile:', profile);
        }
      } catch (error) {
        console.error('[MCPChat] Error loading saved user data:', error);
        // Non-fatal - continue without saved data
      }
    };
    
    // Only load when authenticated and session is ready
    if (isAuthenticated || effectiveUserId) {
      loadSavedUserData();
    }
  }, [isAuthenticated, effectiveUserId, forceUnauthenticated, sessionId, userTimezone, requireAuth]);

  // Check authentication status when payment setup is triggered
  useEffect(() => {
    const checkAuth = async () => {
      // If user already completed auth gate, skip re-checking
      if (hasCompletedAuthGate) {
        console.log('[MCPChat] Auth gate already completed - staying authenticated');
        return;  // Don't re-run auth checks
      }
      
      // Auth-first mode: use effectiveUserId from prop
      if (requireAuth && effectiveUserId) {
        setIsAuthenticated(true);
        return;
      }
      
      // If force unauthenticated mode, don't check real auth
      if (forceUnauthenticated && !effectiveUserId) {
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
            // Add inline "Preparing authorization..." message before showing auth gate
            setMessages((prev) => {
              // Avoid duplicate auth messages
              if (prev.some(m => m.content.includes('Preparing authorization'))) return prev;
              return [
                ...prev,
                { role: "assistant", content: "🔐 Preparing authorization..." }
              ];
            });
            setShowAuthGate(true);
          }
        }
        return;
      }
      
      if (effectiveUserId) {
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
          // Add inline "Preparing authorization..." message before showing auth gate
          setMessages((prev) => {
            // Avoid duplicate auth messages
            if (prev.some(m => m.content.includes('Preparing authorization'))) return prev;
            return [
              ...prev,
              { role: "assistant", content: "🔐 Preparing authorization..." }
            ];
          });
          setShowAuthGate(true);
        }
      }
    };
    
    checkAuth();
  }, [messages, effectiveUserId, forceUnauthenticated, hasCompletedAuthGate, requireAuth]);

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
        
        // Add "Auth complete" message then continue with payment form
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "✅ Auth complete" },
          { 
            role: "assistant", 
            content: "Now let's set up your payment method.",
            metadata: pendingPaymentMetadata
          },
        ]);
        
        setPendingPaymentMetadata(null);
      }
      
      // Auto-retry pending protected action after successful auth
      if (event === 'SIGNED_IN' && pendingProtectedAction && session?.user?.id) {
        console.log('[MCPChat] User signed in, retrying pending protected action:', pendingProtectedAction.action);
        setShowAuthGate(false);
        setHasCompletedAuthGate(true);
        setIsAuthenticated(true);
        
        // Short delay to ensure auth state is fully propagated
        setTimeout(() => {
          if (pendingProtectedAction) {
            handleCardAction(pendingProtectedAction.action, {
              ...pendingProtectedAction.payload,
              user_id: session.user.id
            });
            setPendingProtectedAction(null);
          }
        }, 500);
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
      // Use effectiveUserId from auth-first pattern, or fallback
      let userId: string | undefined;
      
      if (effectiveUserId) {
        userId = effectiveUserId;
        console.log('[MCPChat] Using authenticated user:', userId);
      } else if (forceUnauthenticated || requireAuth) {
        // No user in auth-first mode means something is wrong, but handle gracefully
        userId = undefined;
        console.log('[MCPChat] No user_id available');
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
    
    // Reset payment state when starting a new registration flow
    if (action === 'select_program') {
      setPaymentCompleted(false);
      console.log('[MCPChat] Reset paymentCompleted for new registration flow');
    }
    
    setLoading(true);
    
    try {
      // Use effectiveUserId from auth-first pattern, or fallback
      let userId: string | undefined;
      
      if (effectiveUserId) {
        userId = effectiveUserId;
        console.log('[MCPChat] Using authenticated user for action:', userId);
      } else if (forceUnauthenticated || requireAuth) {
        userId = undefined;
        console.log('[MCPChat] No user_id for action');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id;
        console.log('[MCPChat] Using authenticated user for action:', userId);
      }
      
      // NOTE: Frontend-side protected action check is now a fallback.
      // The server returns 401 for protected actions without auth (primary enforcement).
      // This client-side check prevents unnecessary network requests.
      const protectedActions = ["confirm_registration", "confirm_payment", "create_booking", "register", "pay", "setup_payment_method", "save_payment_method", "cancel_registration", "view_receipts", "view_audit_trail", "confirm_auto_registration"];
      if (!userId && protectedActions.includes(action)) {
        console.warn(`[MCPChat] ${action} requires sign-in – showing inline auth prompt (client-side check)`);
        // Store pending action for retry after auth
        setPendingProtectedAction({ action, payload });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Before we continue, **sign in to your account** is required.",
            cards: [{
              title: "Sign in required to continue",
              description: `Action "${action}" requires authentication.`,
              buttons: [{ label: "Connect Account", action: "authenticate", variant: "accent" }]
            }]
          }
        ]);
        setLoading(false);
        return; // Halt - do not call backend
      }
      
      // Handle the "authenticate" pseudo-action (triggered by Connect Account button)
      if (action === 'authenticate') {
        console.log('[MCPChat] Opening auth drawer via user-initiated Connect Account');
        // Show "Preparing authorization..." status message (avoid duplicates)
        setMessages((prev) => {
          if (prev.some(m => m.content.includes('Preparing authorization'))) return prev;
          return [...prev, { role: "assistant", content: "🔐 Preparing authorization..." }];
        });
        setShowAuthGate(true);
        setLoading(false);
        return; // Don't call sendAction
      }
      
      // Include user_id in payload for backend operations (esp. payment)
      const enrichedPayload = userId ? { ...payload, user_id: userId } : payload;
      
      const response = await sendAction(action, enrichedPayload, sessionId, undefined, userTimezone);
      
      // Handle 401 response from server (protected action without auth)
      if ((response as any)._status === 401) {
        console.log('[MCPChat] Server returned 401 - protected action requires auth:', (response as any).action_requiring_auth);
        // Store pending action for retry after auth
        setPendingProtectedAction({ action, payload: enrichedPayload });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Before we continue, **sign in to your account** is required.",
            cards: [{
              title: "Sign in required to continue",
              description: `Action "${(response as any).action_requiring_auth || action}" requires authentication.`,
              buttons: [{ label: "Connect Account", action: "authenticate", variant: "accent" }]
            }]
          }
        ]);
        setLoading(false);
        return;
      }
      
      // If delegate profile was saved during form submission, update local state
      if (action === 'submit_form' && payload.saveDelegateProfile && payload.formData) {
        const formData = payload.formData.delegate_data || payload.formData;
        setDelegateProfile({
          delegate_dob: formData.delegate_dob,
          delegate_relationship: formData.delegate_relationship,
          delegate_phone: formData.delegate_phone,
          delegate_firstName: formData.delegate_firstName,
          delegate_lastName: formData.delegate_lastName
        });
        console.log('[MCPChat] Updated delegate profile from form submission:', formData);
      }
      
      // If new children were saved during form submission, update local state
      if (action === 'submit_form' && payload.saveNewChildren && payload.saveNewChildren.length > 0) {
        // Add new children to savedChildren state (backend generates IDs, so use temp IDs)
        // Note: saveNewChildren uses snake_case (first_name, last_name)
        const newChildren = payload.saveNewChildren.map((child: any, index: number) => ({
          id: `temp-${Date.now()}-${index}`, // Temp ID until next reload
          first_name: child.first_name,
          last_name: child.last_name,
          dob: child.dob
        }));
        setSavedChildren(prev => [...prev, ...newChildren]);
        console.log('[MCPChat] Added new children to saved state:', newChildren);
      }
      
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
      
      // Mark payment as complete when booking succeeds (hides payment form)
      if (action === 'confirm_payment' && response.message?.includes('Booking')) {
        setPaymentCompleted(true);
        console.log('[MCPChat] Booking confirmed - hiding payment form');
      }
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
        {effectiveUserId ? (
          <Badge variant="default" className="text-xs">
            🔐 Authenticated: {effectiveUserEmail || effectiveUserId.slice(0, 8)}...
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
                          <>
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
                            
                            {/* Fee Breakdown for payment authorization cards */}
                            {(card.metadata.programFeeCents != null || card.metadata.serviceFeeCents != null) && (
                              <FeeBreakdown
                                programFee={(card.metadata.programFeeCents || 0) / 100}
                                serviceFee={(card.metadata.serviceFeeCents || 2000) / 100}
                                total={((card.metadata.programFeeCents || 0) + (card.metadata.serviceFeeCents || 2000)) / 100}
                                programFeeLabel={COPY.fees.programFeeLabel}
                                serviceFeeLabel={COPY.fees.serviceFeeLabel}
                                serviceFeeNote={COPY.fees.serviceFeeNote}
                              />
                            )}
                            
                            {/* Trust callout for payment cards */}
                            {card.metadata.isPaymentCard && (
                              <TrustCallout
                                title={COPY.trust.title}
                                bullets={COPY.trust.bullets}
                                footer={COPY.trust.payment}
                              />
                            )}
                          </>
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
                        initialDelegateData={userFormData ? {
                          delegate_email: userFormData.email,
                          delegate_firstName: userFormData.firstName,
                          delegate_lastName: userFormData.lastName
                        } : undefined}
                        initialDelegateProfile={delegateProfile || undefined}
                        savedChildren={savedChildren}
                        onSubmit={(data) => {
                          // Mark this form as submitted
                          setSubmittedFormIds(prev => new Set(prev).add(idx));
                          
                          // Build payload with form data and optional save flags
                          const payload: any = { formData: data };
                          if (data.saveNewChildren && data.saveNewChildren.length > 0) {
                            payload.saveNewChildren = data.saveNewChildren;
                          }
                          if (data.saveDelegateProfile) {
                            payload.saveDelegateProfile = true;
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
                  initialDelegateProfile={delegateProfile || undefined}
                  onSubmit={(data) => {
                    // Mark this form as submitted
                    setSubmittedFormIds(prev => new Set(prev).add(idx));
                    handleCardAction('submit_form', { formData: data });
                  }}
                />
              )}

              {/* Show payment setup indicator in message - only when not completed */}
              {msg.metadata?.componentType === 'payment_setup' && !paymentCompleted && (
                <Badge variant="secondary" className="mt-2">
                  💳 Payment setup in progress...
                </Badge>
              )}
              {msg.metadata?.componentType === 'payment_setup' && paymentCompleted && (
                <Badge variant="default" className="mt-2 bg-green-600">
                  ✅ Payment method saved
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
                  mockUserId={effectiveUserId}
                  mockUserEmail={effectiveUserEmail}
                  hasPaymentMethod={paymentCompleted}
                  onPaymentMethodSaved={async () => {
                    console.log('[MCPChat] Payment method saved');
                    // NOTE: Don't set paymentCompleted until AFTER handleCardAction completes
                    // This ensures the success message with buttons is added to messages first
                    
                    // Get user info from effectiveUserId (auth-first pattern)
                    let userId: string | undefined;
                    let userEmail: string | undefined;
                    
                    if (effectiveUserId && effectiveUserEmail) {
                      userId = effectiveUserId;
                      userEmail = effectiveUserEmail;
                      console.log('[MCPChat] Using authenticated user for payment callback:', userId);
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
                      // Immediate registration - show payment authorization card first
                      console.log('[MCPChat] Showing payment authorization card after payment setup');
                      setPaymentCompleted(true); // Hide the payment form
                      
                      // Request the payment authorization card from orchestrator
                      await handleCardAction('show_payment_authorization', {
                        user_id: userId,
                        schedulingData: lastPaymentMessage.metadata?.schedulingData
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

                      // Get session token (only if real user authenticated via Supabase)
                      let accessToken: string | undefined;
                      if (!requireAuth) {
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
                      setPaymentCompleted(true);
                    } else {
                      console.warn('[MCPChat] Unknown next_action:', nextAction);
                      setPaymentCompleted(true); // Still hide form for unknown actions
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
