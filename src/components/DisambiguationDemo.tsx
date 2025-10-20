import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatMessageCard } from "./ChatMessageCard";
import { ConnectAccountCard } from "./ConnectAccountCard";
import { useProviderDisambiguation } from "@/hooks/useProviderDisambiguation";
import { ChatMessage } from "@/types/chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send } from "lucide-react";

export function DisambiguationDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const { 
    handleSingleMatch, 
    handleMultipleMatches, 
    handleNoMatch, 
    handleConfirmation,
    handleTextConfirmation,
    handleWrongSelection,
    detectWrongSelection,
    handleTextFallback, 
    parseMultipleMatchSelection, 
    context 
  } = useProviderDisambiguation();

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

  const simulateMultipleMatches = () => {
    const assistantMsg = handleMultipleMatches(
      [
        {
          name: "Blackhawk Ski Club",
          city: "Middleton, WI",
          address: "123 Ski Lane, Middleton, WI 53562",
          orgRef: "blackhawk-middleton",
        },
        {
          name: "Blackhawk Ski Club",
          city: "Madison, WI",
          address: "456 Snow Drive, Madison, WI 53703",
          orgRef: "blackhawk-madison",
        },
        {
          name: "Blackhawk Ski Club",
          city: "Verona, WI",
          address: "789 Slope Road, Verona, WI 53593",
          orgRef: "blackhawk-verona",
        },
      ],
      "Blackhawk"
    );
    
    setMessages(prev => [...prev, assistantMsg]);
  };

  const simulateNoMatch = () => {
    const assistantMsg = handleNoMatch("Unknown Sports Club");
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

    // Check for wrong selection first (applies to confirmed provider state)
    if (context?.confirmedProvider && detectWrongSelection(input)) {
      const assistantMsg = handleWrongSelection();
      setMessages(prev => [...prev, assistantMsg]);
      setInput("");
      return;
    }

    // Handle text fallback for single match
    if (context?.type === "single_match") {
      const isAffirmative = handleTextFallback(input, "confirm");
      const isNegative = handleTextFallback(input, "reject");

      if (isAffirmative && context.providers?.[0]) {
        handleTextConfirmation(context.providers[0]).then(assistantMsg => {
          setMessages(prev => [...prev, assistantMsg]);
        });
      } else if (isNegative) {
        const assistantMsg = handleConfirmation(false, {});
        setMessages(prev => [...prev, assistantMsg]);
      }
    }

    // Handle text fallback for multiple matches
    if (context?.type === "multiple_matches") {
      const { cityMatch, isNoneMatch, isUnclear } = parseMultipleMatchSelection(input);

      if (isNoneMatch) {
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant" as const,
          content: "Got it! Maybe I need more details. Could you double-check the name or provide the city to search again?",
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else if (isUnclear) {
        const cities = context.providers?.map(p => p.city || "Unknown").join(", ") || "";
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant" as const,
          content: `Sure – just let me know which one. Here are the locations: **${cities}**. You can click a card or tell me the city name.`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else if (cityMatch && context.providers) {
        const matchedProvider = context.providers.find(
          p => (p.city || p.address || "").includes(cityMatch!)
        );
        
        if (matchedProvider) {
          const confirmMsg: ChatMessage = {
            id: `msg-${Date.now()}-confirm`,
            role: "assistant" as const,
            content: `Thanks! We'll go with **${matchedProvider.name}** (${matchedProvider.city || matchedProvider.address}).`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, confirmMsg]);
          
          setTimeout(() => {
            const assistantMsg = handleConfirmation(true, matchedProvider);
            setMessages(prev => [...prev, assistantMsg]);
          }, 500);
        }
      }
    }

    // Handle text fallback for no match - simulate new search with user's input
    if (context?.type === "no_match") {
      // Simulate finding results based on the new input
      const normalizedInput = input.toLowerCase();
      
      if (normalizedInput.includes("blackhawk") || normalizedInput.includes("middleton")) {
        // Simulate finding a single match
        setTimeout(() => {
          const assistantMsg = handleSingleMatch(
            {
              name: "Blackhawk Ski Club",
              city: "Middleton, WI",
              address: "123 Ski Lane, Middleton, WI 53562",
              orgRef: "blackhawk-ski",
            },
            input
          );
          setMessages(prev => [...prev, assistantMsg]);
        }, 500);
      } else if (normalizedInput.includes("sunshine")) {
        // Simulate finding multiple matches
        setTimeout(() => {
          const assistantMsg = handleMultipleMatches(
            [
              {
                name: "Sunshine Soccer Club",
                city: "Chicago, IL",
                address: "100 Park Ave, Chicago, IL 60601",
                orgRef: "sunshine-chicago",
              },
              {
                name: "Sunshine Soccer Club",
                city: "Springfield, IL",
                address: "200 Field Road, Springfield, IL 62701",
                orgRef: "sunshine-springfield",
              },
            ],
            input
          );
          setMessages(prev => [...prev, assistantMsg]);
        }, 500);
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
            Testing Case 1 (Single Match) and Case 2 (Multiple Matches) with card confirmation and text fallback
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={simulateSingleMatch} variant="outline" className="flex-1">
              Single Match
            </Button>
            <Button onClick={simulateMultipleMatches} variant="outline" className="flex-1">
              Multiple Matches
            </Button>
            <Button onClick={simulateNoMatch} variant="outline" className="flex-1">
              No Match
            </Button>
          </div>

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

                    {(msg as any).payload?.type === 'connect_account' && (
                      <div className="mt-3">
                        <ConnectAccountCard
                          provider={(msg as any).payload.provider}
                          orgName={(msg as any).payload.org_name}
                          orgRef={(msg as any).payload.org_ref}
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
            <strong>Single Match:</strong> Try "yes", "that's it", "no"<br />
            <strong>Multiple Matches:</strong> Try "Middleton", "the Madison one", "none of these", "not sure"<br />
            <strong>No Match:</strong> Try "Blackhawk Middleton", "Sunshine Chicago", or any other search term<br />
            <strong>After Confirmation:</strong> Try "oops, not that one" or "that's not my club" to restart
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
