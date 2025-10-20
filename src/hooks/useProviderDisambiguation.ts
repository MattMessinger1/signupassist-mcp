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

  const handleMultipleMatches = (
    providers: Array<{ name: string; city?: string; address?: string; orgRef?: string }>,
    searchQuery: string
  ): ChatMessage => {
    setContext({
      type: "multiple_matches",
      searchQuery,
      providers,
    });

    const providerData = providers.map(p => ({
      name: p.name,
      location: p.city || p.address || "Unknown location",
      orgRef: p.orgRef,
    }));

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: `I found a few organizations named **${searchQuery}**. Which one is yours?`,
      timestamp: new Date(),
      card: {
        type: "multiple_providers",
        data: providerData,
      },
    };
  };

  const handleConfirmation = (confirmed: boolean, providerData: any): ChatMessage => {
    if (confirmed) {
      toast({
        title: "Organization confirmed",
        description: `Proceeding with ${providerData.name}`,
      });
      
      // Store confirmed provider with full context
      setContext(prev => prev ? { 
        ...prev, 
        confirmedProvider: {
          name: providerData.name,
          location: providerData.location,
          orgRef: providerData.orgRef,
          provider: providerData.provider || 'skiclubpro'
        } 
      } : null);
      
      return {
        id: `msg-${Date.now()}`,
        role: "assistant" as const,
        content: `Great! We'll work with **${providerData.name}** (${providerData.location}). 👍\n\nNext, I'll connect securely to their system to check class availability. You'll log in directly with ${providerData.name} — I never see or store your password.`,
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

  const parseMultipleMatchSelection = (userInput: string): { cityMatch?: string; isNoneMatch: boolean; isUnclear: boolean } => {
    const input = userInput.toLowerCase().trim();
    
    // Check for "none of these" type responses
    const nonePatterns = ["none of these", "none of them", "not listed", "not here", "different one"];
    const isNoneMatch = nonePatterns.some(pattern => input.includes(pattern));

    // Check for unclear responses
    const unclearPatterns = ["not sure", "maybe", "i don't know", "idk", "unclear"];
    const isUnclear = unclearPatterns.some(pattern => input.includes(pattern));

    // Try to extract city from the input
    let cityMatch: string | undefined;
    
    if (context?.providers) {
      for (const provider of context.providers) {
        const location = provider.city || provider.address || "";
        const cityWords = location.split(/[,\s]+/).filter(w => w.length > 2);
        
        for (const word of cityWords) {
          if (input.includes(word.toLowerCase())) {
            cityMatch = provider.city || provider.address;
            break;
          }
        }
        
        if (cityMatch) break;
      }
    }

    return { cityMatch, isNoneMatch, isUnclear };
  };

  const handleNoMatch = (searchQuery: string): ChatMessage => {
    setContext({
      type: "no_match",
      searchQuery,
    });

    return {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: `Hmm, I didn't find an obvious match for that organization. Could you double-check the name or give me more info (like the city or school name)? 🤔\n\nDon't worry, we only use this info to look up your club, and your data stays private.`,
      timestamp: new Date(),
    };
  };

  return {
    context,
    handleSingleMatch,
    handleMultipleMatches,
    handleNoMatch,
    handleConfirmation,
    handleTextFallback,
    parseMultipleMatchSelection,
    clearContext: () => setContext(null),
  };
}
