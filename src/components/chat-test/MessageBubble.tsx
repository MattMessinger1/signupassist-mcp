/**
 * MessageBubble Component
 * 
 * Renders individual chat messages with support for:
 * - User and assistant message styling
 * - Markdown-style formatting (bold, italic, lists)
 * - Interactive components (confirmation cards, carousels, forms, status chips)
 * - Responsive layout
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmationCard } from "./ConfirmationCard";
import { GroupedProgramCards } from "./GroupedProgramCards";
import { OptionsCarousel } from "./OptionsCarousel";
import { InlineChatForm } from "./InlineChatForm";
import { StatusChip } from "./StatusChip";
import { Loader2 } from "lucide-react";

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  componentType?: "confirmation" | "carousel" | "form" | "status" | "cards" | "cards-grouped" | "test-comparison";
  componentData?: any;
  role?: "user" | "assistant";
  content?: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  onAction?: (action: string, payload: any) => void;
}

/**
 * Renders text with markdown-style formatting
 * Supports: **bold**, *italic*, • bullet lists
 */
function renderFormattedText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
}

export function MessageBubble({ 
  message, 
  onAction 
}: MessageBubbleProps) {
  const isUser = message.sender === "user" || message.role === "user";

  // Handle card button clicks
  const handleCardButtonClick = (action: string, payload: any) => {
    console.log('[MessageBubble] Button clicked:', action, payload);
    if (onAction) {
      onAction(action, payload);
    }
  };

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-primary text-primary-foreground ml-auto"
            : "bg-muted text-foreground"
        )}
      >
        {/* Loading state */}
        {message.componentData?.loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>🔍 Pulling relevant listings...</span>
          </div>
        )}
        
        {/* Main message text with formatting */}
        {(message.text || message.content) && (
          <div 
            className="text-sm leading-relaxed whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ 
              __html: renderFormattedText(message.text || message.content || '')
            }}
          />
        )}
        
        {/* Interactive Components */}
        {/* Render cards from orchestrator response */}
        {message.componentData?.cards && message.componentData.cards.map((card: any, idx: number) => (
          <div key={idx} className="mt-3">
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{card.title}</CardTitle>
                {card.subtitle && <CardDescription>{card.subtitle}</CardDescription>}
              </CardHeader>
              {card.description && (
                <CardContent className="pb-3">
                  <CardDescription className="text-foreground whitespace-pre-line">
                    {card.description}
                  </CardDescription>
                </CardContent>
              )}
              {card.buttons && card.buttons.length > 0 && (
                <CardFooter className="flex flex-wrap gap-2">
                  {card.buttons.map((btn: any, btnIdx: number) => (
                    <Button
                      key={btnIdx}
                      onClick={() => handleCardButtonClick(btn.action, btn.payload || card.metadata)}
                      variant={btn.variant === "accent" ? "default" : "outline"}
                      size="sm"
                      className="flex-1 min-w-[120px]"
                    >
                      {btn.label}
                    </Button>
                  ))}
                </CardFooter>
              )}
            </Card>
          </div>
        ))}

        {/* Test Comparison View */}
        {message.componentData?.testComparison && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="border rounded-lg p-3 bg-background">
              <h4 className="font-semibold text-xs mb-2 text-primary">Orchestrator Mode</h4>
              <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground">
                {JSON.stringify(message.componentData.testComparison.orchestrator, null, 2)}
              </pre>
            </div>
            <div className="border rounded-lg p-3 bg-background">
              <h4 className="font-semibold text-xs mb-2 text-secondary">MCP Direct Mode</h4>
              <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground">
                {JSON.stringify(message.componentData.testComparison.mcp, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Grouped Program Cards */}
        {message.componentType === "cards-grouped" && message.componentData && (
          <div className="mt-3">
            <GroupedProgramCards
              payload={message.componentData}
              onAction={onAction}
            />
          </div>
        )}

        {/* Raw MCP Output */}
        {message.componentData?.rawMCP && (
          <pre className="mt-3 p-3 bg-slate-900 dark:bg-slate-950 rounded-lg text-[10px] overflow-x-auto font-mono text-slate-100">
            {JSON.stringify(message.componentData.rawMCP, null, 2)}
          </pre>
        )}

      </div>
    </div>
  );
}
