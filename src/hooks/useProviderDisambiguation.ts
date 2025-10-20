import { useState } from "react";
import { ChatMessage, DisambiguationContext } from "@/types/chat";
import { toast } from "@/hooks/use-toast";

export function useProviderDisambiguation() {
  const [context, setContext] = useState<DisambiguationContext | null>(null);

  const handleSingleMatch = (
    provider: { name: string; city?: string; address?: string; orgRef?: string },
    searchQuery: string
  ): ChatMessage => {
    const location = provider.city || provider.address || "Unknown location";
    
    setContext({
      type: "single_match",
      searchQuery,
      providers: [provider],
    });

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: `Great news! I found **${provider.name}** in ${location}. Is that the one you mean?\n\n_We only use this info to look up your organization; your data stays private._`,
      timestamp: new Date(),
      card: {
        type: "provider_confirmation",
        data: {
          name: provider.name,
          location,
          orgRef: provider.orgRef,
        },
      },
    };
  };

  const handleConfirmation = (confirmed: boolean, providerData: any): ChatMessage => {
    if (confirmed) {
      toast({
        title: "Organization confirmed",
        description: `Proceeding with ${providerData.name}`,
      });
      
      // Store confirmed provider
      setContext(prev => prev ? { ...prev, confirmedProvider: providerData } : null);
      
      return {
        id: `msg-${Date.now()}`,
        role: "assistant" as const,
        content: `Perfect! I'll help you get signed up with **${providerData.name}**. Let me check what I need from you...`,
        timestamp: new Date(),
      };
    } else {
      setContext(null);
      return {
        id: `msg-${Date.now()}`,
        role: "assistant" as const,
        content: "No worries! Could you give me the organization name again or add a location to help me find the right one?",
        timestamp: new Date(),
      };
    }
  };

  const handleTextFallback = (userInput: string, expectedAction: "confirm" | "reject"): boolean => {
    const input = userInput.toLowerCase().trim();
    
    // Affirmative responses
    const affirmative = ["yes", "yep", "yeah", "correct", "right", "that's it", "that's the one", "yes that's it"];
    // Negative responses  
    const negative = ["no", "nope", "not that one", "wrong", "incorrect", "not sure"];

    if (expectedAction === "confirm") {
      return affirmative.some(phrase => input.includes(phrase));
    } else {
      return negative.some(phrase => input.includes(phrase));
    }
  };

  return {
    context,
    handleSingleMatch,
    handleConfirmation,
    handleTextFallback,
    clearContext: () => setContext(null),
  };
}
