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
  onAction?: (action: string, payload: any) => void;
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
  onAction,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isProcessing]);

  // Debug: Log messages to console
  console.log('[MessageList] Rendering with messages:', messages.length, messages);

  return (
    <ScrollArea className="flex-1 px-4 py-6" ref={scrollRef}>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Debug info - REMOVE AFTER FIXING */}
        <div className="bg-yellow-100 border-2 border-yellow-500 p-4 text-black">
          <div className="font-bold">DEBUG INFO:</div>
          <div>Messages count: {messages.length}</div>
          <div>MCP Connected: {mcpConnected ? 'YES' : 'NO'}</div>
          <div>Is Processing: {isProcessing ? 'YES' : 'NO'}</div>
          {messages.length > 0 && (
            <div className="mt-2">
              <div>First message ID: {messages[0].id}</div>
              <div>First message text: {messages[0].text.substring(0, 50)}</div>
            </div>
          )}
        </div>
        
        {!mcpConnected && <ConnectionWarning />}
        
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onAction={onAction}
          />
        ))}
        
        {isProcessing && <ProcessingIndicator />}
      </div>
    </ScrollArea>
  );
}
