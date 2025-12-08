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
import { StatusChip } from "./StatusChip";
import { PrereqChecklistCard } from "@/components/PrereqChecklistCard";
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
  title?: string;
  message?: string;
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
    console.log('[MessageBubble] Button clicked:', {
      action,
      payload,
      payload_type: typeof payload,
      payload_keys: payload ? Object.keys(payload) : [],
      has_program_data: !!payload?.program_data,
      program_data_keys: payload?.program_data ? Object.keys(payload.program_data) : [],
      stringified: JSON.stringify(payload)
    });
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
                  <CardDescription 
                    className="text-foreground whitespace-pre-line prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderFormattedText(card.description || '') }}
                  />
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
        
        {/* Legacy form component type removed - now using ResponsibleDelegateForm in MCPChat */}

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

        {/* Prerequisite Checklist Card */}
        {message.componentData?.type === "prereq_checklist" && (
          <div className="mt-3">
            <PrereqChecklistCard
              title={message.componentData.title}
              program_ref={message.componentData.program_ref}
              prerequisites={message.componentData.prerequisites || {}}
              questions={message.componentData.questions || []}
              deep_link={message.componentData.deep_link}
              onAction={onAction}
            />
          </div>
        )}

        {/* Carousel for Bookeo programs */}
        {message.componentType === "carousel" && message.componentData && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {message.componentData.items?.map((item: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 space-y-2 bg-card">
                  {item.image_url && (
                    <img src={item.image_url} alt={item.title} className="w-full h-32 object-cover rounded" />
                  )}
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                  <p className="text-sm font-medium">{item.caption}</p>
                  {item.body && <p className="text-xs text-muted-foreground">{item.body}</p>}
                  {item.action && (
                    <Button
                      onClick={() => onAction?.(item.action.tool, item.action.input)}
                      className="w-full mt-2"
                      size="sm"
                    >
                      {item.action.label}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Confirmation card for booking approval */}
        {message.componentType === "confirmation" && message.componentData && (
          <div className="mt-3 border rounded-lg p-4 space-y-3 bg-card">
            <h4 className="font-semibold text-lg">{message.componentData.title}</h4>
            <div className="whitespace-pre-line text-sm">{message.componentData.body}</div>
            <div className="flex gap-2">
              {message.componentData.confirmAction && (
                <Button
                  onClick={() => onAction?.(
                    message.componentData.confirmAction.tool,
                    message.componentData.confirmAction.input
                  )}
                  className="flex-1"
                  size="sm"
                >
                  {message.componentData.confirmAction.label}
                </Button>
              )}
              {message.componentData.cancelAction && (
                <Button
                  onClick={() => onAction?.('cancel', {})}
                  variant="outline"
                  className="flex-1"
                  size="sm"
                >
                  {message.componentData.cancelAction.label}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Status messages */}
        {message.componentType === "status" && (
          <div className="mt-3 border rounded-lg p-4 bg-card">
            {message.title && <h4 className="font-semibold mb-2">{message.title}</h4>}
            {message.message && <div className="whitespace-pre-line text-sm">{message.message}</div>}
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
