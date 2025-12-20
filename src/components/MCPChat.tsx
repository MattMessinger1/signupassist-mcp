import { useState, useRef, useEffect, useCallback } from "react";
import { sendMessage, sendAction } from "@/lib/orchestratorClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Send, CreditCard, Sparkles, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResponsibleDelegateForm } from "./chat-test/ResponsibleDelegateForm";
import { SavePaymentMethod, getAndClearStripeReturnState, persistStateBeforeStripeRedirect } from "./SavePaymentMethod";
import { AuthGateModal } from "./AuthGateModal";
import { FeeBreakdown } from "./FeeBreakdown";
import { TrustCallout } from "./TrustCallout";
import { COPY } from "@/copy/signupassistCopy";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo } from "./BrandLogo";
import { getButtonVariantForLabel } from "@/lib/utils/programStatusHelpers";

// Helper to render markdown-style text as HTML
function renderFormattedText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-4">$&</ul>');
}

// Storage key for persisted chat state (using localStorage for cross-tab persistence)
const CHAT_STATE_KEY = 'mcp_chat_state_v2';

// Helper to safely access localStorage
const getPersistedState = (): any | null => {
  try {
    const raw = localStorage.getItem(CHAT_STATE_KEY);
    if (!raw) return null;
    
    const state = JSON.parse(raw);
    // Check if state is stale (older than 30 minutes)
    if (state.timestamp && Date.now() - state.timestamp > 30 * 60 * 1000) {
      console.log('[MCPChat] Persisted state is stale, clearing');
      localStorage.removeItem(CHAT_STATE_KEY);
      return null;
    }
    return state;
  } catch (e) {
    console.error('[MCPChat] Failed to parse persisted state:', e);
    localStorage.removeItem(CHAT_STATE_KEY);
    return null;
  }
};

const setPersistedState = (state: any) => {
  try {
    localStorage.setItem(CHAT_STATE_KEY, JSON.stringify({
      ...state,
      timestamp: Date.now()
    }));
    console.log('[MCPChat] State persisted to localStorage:', {
      messageCount: state.messages?.length || 0,
      hasFormData: Object.keys(state.formData || {}).length > 0,
      hasPaymentMeta: !!state.pendingPaymentMetadata
    });
  } catch (e) {
    console.error('[MCPChat] Failed to persist state:', e);
  }
};

const clearPersistedState = () => {
  localStorage.removeItem(CHAT_STATE_KEY);
  console.log('[MCPChat] Cleared persisted state');
};

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
  const [sessionId, setSessionId] = useState(`lovable-test-${Date.now()}`);
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
  
  // Refs to track state restoration (prevents race conditions)
  const stateRestoredRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const paymentCallbackFiredRef = useRef(false); // Guard against double payment callback
  
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

  // Reset auth state when user logs out (effectiveUserId becomes undefined)
  useEffect(() => {
    if (!effectiveUserId && forceUnauthenticated) {
      console.log('[MCPChat] User logged out - resetting auth state');
      setHasCompletedAuthGate(false);
      setIsAuthenticated(false);
    } else if (effectiveUserId) {
      setIsAuthenticated(true);
    }
  }, [effectiveUserId, forceUnauthenticated]);

  // CONSOLIDATED STATE RESTORATION - runs once on mount
  useEffect(() => {
    if (!isInitialMountRef.current) return;
    isInitialMountRef.current = false;
    
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSetup = urlParams.get('payment_setup');
    
    // Priority 1: Check for Stripe return
    if (paymentSetup === 'success' || paymentSetup === 'canceled') {
      console.log('[MCPChat] Detected Stripe return, checking for persisted state...');
      const restoredState = getAndClearStripeReturnState();
      
      if (restoredState) {
        console.log('[MCPChat] Restoring state from Stripe redirect:', restoredState);
        stateRestoredRef.current = true;
        setSessionId(restoredState.sessionId);
        setMessages(restoredState.messages);
        setFormData(restoredState.formData || {});
        setPendingPaymentMetadata(restoredState.pendingPaymentMetadata);
        
        toast({
          title: 'Welcome back!',
          description: paymentSetup === 'success' 
            ? 'Verifying your payment method...' 
            : 'Payment setup was canceled.',
        });
      }
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    
    // Priority 2: Check for persisted state (auth return) - using localStorage for cross-tab
    const persistedState = getPersistedState();
    if (persistedState) {
      console.log('[MCPChat] Found persisted state, restoring...', {
        hasMessages: persistedState.messages?.length,
        hasFormData: Object.keys(persistedState.formData || {}).length,
        hasPaymentMetadata: !!persistedState.pendingPaymentMetadata
      });
      
      stateRestoredRef.current = true;
      setSessionId(persistedState.sessionId);
      setMessages(persistedState.messages || []);
      setFormData(persistedState.formData || {});
      setPendingPaymentMetadata(persistedState.pendingPaymentMetadata);
      setHasCompletedAuthGate(true); // User just completed auth
      
      // Clear immediately to prevent re-restore
      clearPersistedState();
      
      toast({
        title: 'Welcome back!',
        description: 'Continuing your registration...',
      });
    }
  }, [toast]);

  // Persist state function - called before redirects
  const persistCurrentState = useCallback(() => {
    setPersistedState({
      sessionId,
      messages,
      formData,
      pendingPaymentMetadata
    });
  }, [sessionId, messages, formData, pendingPaymentMetadata]);

  // Expose persist function for Stripe redirect
  useEffect(() => {
    (window as any).__persistMCPChatState = () => {
      persistStateBeforeStripeRedirect({
        sessionId,
        messages,
        formData,
        pendingPaymentMetadata
      });
    };
    
    return () => {
      delete (window as any).__persistMCPChatState;
    };
  }, [sessionId, messages, formData, pendingPaymentMetadata]);

  // Persist state when auth gate opens
  useEffect(() => {
    if (showAuthGate && messages.length > 0) {
      console.log('[MCPChat] Auth gate opened, persisting state for magic link return...');
      persistCurrentState();
    }
  }, [showAuthGate, persistCurrentState, messages.length]);

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
      // If state was just restored from redirect, skip re-checking to prevent race condition
      if (stateRestoredRef.current) {
        console.log('[MCPChat] State just restored - skipping checkAuth to prevent race');
        stateRestoredRef.current = false; // Reset for future checks
        return;
      }
      
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
          lastChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [messages, loading]);

  // Listen for auth state changes - handles post-auth continuation
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[MCPChat] Auth state changed:', event, session?.user?.id);
      
      // Handle SIGNED_IN event (user just signed in via magic link or other method)
      if (event === 'SIGNED_IN' && session?.user) {
        setShowAuthGate(false);
        setHasCompletedAuthGate(true);
        setIsAuthenticated(true);
        
        // Check for persisted state that wasn't already restored on mount (using localStorage)
        const persistedState = getPersistedState();
        if (persistedState && messages.length === 0) {
          console.log('[MCPChat] Auth listener restoring state:', {
            hasMessages: persistedState.messages?.length,
            hasPaymentMeta: !!persistedState.pendingPaymentMetadata
          });
          
          clearPersistedState();
          
          const restoredMessages = persistedState.messages || [];
          const restoredPaymentMetadata = persistedState.pendingPaymentMetadata;
          
          setSessionId(persistedState.sessionId);
          setFormData(persistedState.formData || {});
          
          // Add success message and continue
          const newMessages: Message[] = [
            ...restoredMessages,
            { role: "assistant", content: "✅ **You're signed in!** Let's continue with your registration." }
          ];
          
          if (restoredPaymentMetadata) {
            newMessages.push({ 
              role: "assistant", 
              content: "Now let's set up your payment method.",
              metadata: restoredPaymentMetadata
            });
          }
          
          setMessages(newMessages);
          setPendingPaymentMetadata(null);
          
          toast({
            title: '✅ Signed in successfully!',
            description: 'Continuing your registration...',
          });
        } else if (pendingProtectedAction && session?.user?.id) {
          // Handle pending protected action retry
          console.log('[MCPChat] Retrying pending protected action:', pendingProtectedAction.action);
          
          toast({
            title: '✅ Signed in successfully!',
            description: 'Retrying your action...',
          });
          
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
      }
      
      // Handle INITIAL_SESSION - just update auth state
      if (event === 'INITIAL_SESSION' && session?.user) {
        setIsAuthenticated(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [pendingPaymentMetadata, pendingProtectedAction, toast, messages.length]);

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
      
      // Handle silent pass (LOW confidence for anonymous users - SignupAssist doesn't activate)
      // In /mcp-chat-test this can feel like the chat is "stuck", so provide a helpful nudge.
      if ((response as any).silentPass) {
        console.log('[MCPChat] Silent pass - SignupAssist not activating for this query');

        const adultPatterns = /\b(adult|adults|grown[-\s]?up|18\+|over\s*18|for\s*adults)\b/i;
        const isAdultsFollowup = adultPatterns.test(userMessage);

        setMessages((prev) => {
          const lastAssistant = [...prev].reverse().find((m) => m.role === 'assistant');
          const lastAskedCity = (lastAssistant?.content || '').toLowerCase().includes('city are you in');

          if (lastAskedCity && isAdultsFollowup) {
            return [...prev, { role: 'assistant', content: 'Got it — adults. What city are you in?' }];
          }

          return prev;
        });

        if (isAdultsFollowup) {
          toast({
            title: 'Quick check',
            description: 'To find adult classes near you, I still need your city (e.g., Madison).',
          });
        }

        return;
      }
      
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
      paymentCallbackFiredRef.current = false; // Reset guard for new flow
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

  // Suggested prompts for high-intent users (execution-focused, not discovery)
  const suggestedPrompts = [
    "Register Emma for Blackhawk ski lessons",
    "Sign up for the Saturday soccer session",
    "Complete my AIM Design camp registration",
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-4 space-y-4 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center space-y-6 max-w-md px-4">
                <BrandLogo size="xl" className="mx-auto" />
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-foreground">
                    Ready to register?
                  </h2>
                  <p className="text-muted-foreground">
                    Tell me what to sign up for and I'll handle the rest.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {suggestedPrompts.map((prompt, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      className="text-sm border-brand-navy/20 hover:bg-brand-navy/5 hover:border-brand-navy/40"
                      onClick={() => send(prompt)}
                    >
                      <Sparkles className="w-3 h-3 mr-2 text-brand-gold" />
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] ${msg.role === "user" ? "ml-12" : "mr-12"}`}>
                <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === "user" 
                    ? "bg-brand-navy text-white" 
                    : "bg-card border border-border"
                }`}>
                  <div 
                    className="text-sm whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: renderFormattedText(msg.content || '') }}
                  />
                </div>
                
                {msg.cards && msg.cards.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 mt-3">
                    {msg.cards.map((card, cardIdx) => (
                      <Card key={cardIdx} className="p-4 border-l-4 border-l-brand-gold shadow-md hover:shadow-lg transition-shadow bg-card">
                        <div className="space-y-2">
                          <div className="font-semibold">{card.title}</div>
                          {card.subtitle && (
                            <div className="text-sm text-muted-foreground">{card.subtitle}</div>
                          )}
                          {card.description && (
                            <div 
                              className="text-sm text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: renderFormattedText(card.description || '') }}
                            />
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
                              
                              {card.metadata.isPaymentCard && (
                                <TrustCallout
                                  title={COPY.trust.title}
                                  bullets={COPY.trust.bullets}
                                  footer={COPY.trust.payment}
                                  refundHelp={COPY.trust.refundHelp}
                                />
                              )}
                            </>
                          )}
                          {card.buttons && card.buttons.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {card.buttons.map((button, btnIdx) => (
                                <Button
                                  key={btnIdx}
                                  variant={getButtonVariantForLabel(button.label, button.variant)}
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

                {msg.cta && msg.cta.buttons && msg.cta.buttons.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {msg.cta.buttons.map((button, btnIdx) => (
                      <Button
                        key={btnIdx}
                        variant={getButtonVariantForLabel(button.label, button.variant)}
                        size="default"
                        onClick={() => handleCardAction(button.action, button.payload || {})}
                        disabled={loading}
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
                            setSubmittedFormIds(prev => new Set(prev).add(idx));
                            const payload: any = { 
                              formData: data,
                              // Include program context for server-side state recovery
                              program_ref: msg.metadata?.program_ref,
                              org_ref: msg.metadata?.org_ref,
                              program_name: msg.metadata?.program_name
                            };
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
                
                {/* Legacy inline form */}
                {msg.metadata?.signupForm && !msg.metadata?.componentType && !submittedFormIds.has(idx) && (
                  <ResponsibleDelegateForm
                    schema={msg.metadata.signupForm}
                    programTitle={msg.metadata.program_ref || "Selected Program"}
                    initialDelegateProfile={delegateProfile || undefined}
                    onSubmit={(data) => {
                      setSubmittedFormIds(prev => new Set(prev).add(idx));
                      handleCardAction('submit_form', { formData: data });
                    }}
                  />
                )}

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
                    // Guard against double-execution (polling + URL detection can both fire)
                    if (paymentCallbackFiredRef.current) {
                      console.log('[MCPChat] Payment callback already fired, skipping duplicate');
                      return;
                    }
                    paymentCallbackFiredRef.current = true;
                    
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
                        paymentCallbackFiredRef.current = false; // Reset on error
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
                      paymentCallbackFiredRef.current = false; // Reset on error
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

      {/* Polished Input Area */}
      <div className="p-4 border-t bg-card/50 backdrop-blur-sm">
        <div className="flex gap-3 max-w-3xl mx-auto">
          <Input
            placeholder="What would you like me to register you for?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            disabled={loading}
            className="flex-1 h-12 text-base border-muted-foreground/20 focus:border-brand-navy focus:ring-brand-navy/20 bg-background"
          />
          <Button 
            onClick={() => send(input)} 
            disabled={loading || !input.trim()}
            size="lg"
            className="h-12 px-5 bg-brand-navy hover:bg-brand-navy/90"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Powered by SignupAssist • Your Responsible Delegate
        </p>
      </div>
    </div>
  );
}
