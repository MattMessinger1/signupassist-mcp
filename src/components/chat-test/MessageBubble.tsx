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
            <ConfirmationCard
              title={card.title}
              message={card.subtitle || card.description || ''}
              onConfirm={() => card.buttons?.[0] && handleCardButtonClick(card.buttons[0].action, card.metadata)}
              onCancel={card.buttons?.[1] ? () => handleCardButtonClick(card.buttons[1].action, card.metadata) : undefined}
              confirmLabel={card.buttons?.[0]?.label}
              cancelLabel={card.buttons?.[1]?.label}
            />
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
