/**
 * ChatInput Component
 * 
 * Input area for typing and sending chat messages.
 * Supports multi-line input with Shift+Enter and send on Enter.
 */

import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Type your message... (Shift+Enter for new line)",
}: ChatInputProps) {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t bg-card px-4 py-4 flex-shrink-0">
      <div className="max-w-3xl mx-auto flex gap-3 items-end">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          className="min-h-[60px] resize-none"
          rows={2}
          disabled={disabled}
        />
        <Button
          onClick={onSend}
          size="icon"
          className="h-[60px] w-[60px] shrink-0"
          disabled={!value.trim() || disabled}
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
