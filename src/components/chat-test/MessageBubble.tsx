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
import { OptionsCarousel } from "./OptionsCarousel";
import { InlineChatForm } from "./InlineChatForm";
import { StatusChip } from "./StatusChip";

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: Date;
  componentType?: "confirmation" | "carousel" | "form" | "status" | "cards";
  componentData?: any;
}

interface MessageBubbleProps {
  message: ChatMessage;
  onConfirm?: () => void;
  onProgramSelect?: (program: any) => void;
  onFormSubmit?: (formId: string, values: any) => void;
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
  onConfirm, 
  onProgramSelect, 
  onFormSubmit,
  onAction 
}: MessageBubbleProps) {
  const isUser = message.sender === "user";

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
        {/* Main message text with formatting */}
        <div 
          className="text-sm leading-relaxed whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ 
            __html: renderFormattedText(message.text)
          }}
        />
        
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

        {message.componentType === "confirmation" && message.componentData && !message.componentData.cards && onConfirm && (
          <ConfirmationCard
            title={message.componentData.title}
            message={message.componentData.message}
            onConfirm={onConfirm}
            confirmLabel={message.componentData.confirmLabel}
            cancelLabel={message.componentData.cancelLabel}
          />
        )}

        {message.componentType === "carousel" && message.componentData && onProgramSelect && (
          <OptionsCarousel
            options={message.componentData.options}
            onSelect={onProgramSelect}
          />
        )}

        {message.componentType === "form" && message.componentData && onFormSubmit && (
          <InlineChatForm
            title={message.componentData.title}
            fields={message.componentData.fields}
            onSubmit={(values) => onFormSubmit(message.id, values)}
          />
        )}

        {message.componentType === "status" && message.componentData && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.componentData.statuses.map((status: any, idx: number) => (
              <StatusChip
                key={idx}
                label={status.label}
                status={status.status}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
