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
  componentType?: "confirmation" | "carousel" | "form" | "status";
  componentData?: any;
}

interface MessageBubbleProps {
  message: ChatMessage;
  onConfirm?: () => void;
  onProgramSelect?: (program: any) => void;
  onFormSubmit?: (formId: string, values: any) => void;
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
  onFormSubmit 
}: MessageBubbleProps) {
  const isUser = message.sender === "user";

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
        {message.componentType === "confirmation" && message.componentData && onConfirm && (
          <ConfirmationCard
            title={message.componentData.title}
            message={message.componentData.message}
            onConfirm={onConfirm}
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
