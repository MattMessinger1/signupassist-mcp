/**
 * MessageList Component
 * 
 * Displays a list of chat messages with auto-scrolling behavior.
 * Shows loading indicator when processing and MCP connection warnings.
 */

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, ChatMessage } from "./MessageBubble";

interface MessageListProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  mcpConnected: boolean;
  onConfirm?: () => void;
  onProgramSelect?: (program: any) => void;
  onFormSubmit?: (formId: string, values: any) => void;
}

/**
 * Loading indicator shown when assistant is processing
 */
function ProcessingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-muted rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="animate-pulse">●</div>
          <div className="animate-pulse delay-100">●</div>
          <div className="animate-pulse delay-200">●</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Warning banner shown when MCP server is not connected
 */
function ConnectionWarning() {
  return (
    <div className="text-center text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
      ⚠️ MCP Server not connected - Check console for details
    </div>
  );
}

export function MessageList({
  messages,
  isProcessing,
  mcpConnected,
  onConfirm,
  onProgramSelect,
  onFormSubmit,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  return (
    <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef}>
      <div className="max-w-3xl mx-auto space-y-6">
        {!mcpConnected && <ConnectionWarning />}
        
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onConfirm={onConfirm}
            onProgramSelect={onProgramSelect}
            onFormSubmit={onFormSubmit}
          />
        ))}
        
        {isProcessing && <ProcessingIndicator />}
      </div>
    </ScrollArea>
  );
}
