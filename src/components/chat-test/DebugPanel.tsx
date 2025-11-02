import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "success" | "error" | "warning" | "debug";
  category: "user" | "tool" | "assistant" | "system" | "mcp" | "orchestrator" | "test" | "tone" | "extractor";
  message: string;
  data?: any;
}

interface DebugPanelProps {
  logs: LogEntry[];
  isVisible: boolean;
  onToggle: () => void;
  onClear: () => void;
}

export function DebugPanel({ logs, isVisible, onToggle, onClear }: DebugPanelProps) {
  if (!isVisible) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          onClick={onToggle}
          size="sm"
          variant="outline"
          className="gap-2 shadow-lg"
        >
          <ChevronUp className="h-4 w-4" />
          Show Debug Log ({logs.length})
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t bg-card">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Debug Log</h3>
          <span className="text-xs text-muted-foreground">({logs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onClear} size="sm" variant="ghost">
            Clear
          </Button>
          <Button onClick={onToggle} size="sm" variant="ghost">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="h-48">
        <div className="p-4 font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <div className="text-muted-foreground italic">No logs yet...</div>
          ) : (
            logs.map((log) => (
              <LogLine key={log.id} log={log} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const levelColors = {
    info: "text-blue-600 dark:text-blue-400",
    success: "text-green-600 dark:text-green-400",
    error: "text-red-600 dark:text-red-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    debug: "text-gray-600 dark:text-gray-400",
  };

  const levelIcons = {
    info: "ℹ️",
    success: "✅",
    error: "❌",
    warning: "⚠️",
    debug: "🔧",
  };

  const categoryLabels: Record<LogEntry['category'], string> = {
    user: "[USER]",
    tool: "[TOOL]",
    assistant: "[ASST]",
    system: "[SYS]",
    mcp: "[MCP]",
    orchestrator: "[ORCH]",
    test: "[TEST]",
    tone: "[TONE]",
    extractor: "[EXTRACT]",
  };

  const timestamp = log.timestamp.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className={cn("leading-tight", levelColors[log.level])}>
      <span className="text-muted-foreground">{timestamp}</span>
      {" "}
      <span>{levelIcons[log.level]}</span>
      {" "}
      <span className="font-semibold">{categoryLabels[log.category]}</span>
      {" "}
      <span>{log.message}</span>
      {log.data && (
        <div className="ml-12 mt-1 text-muted-foreground text-[10px] whitespace-pre-wrap break-all">
          {typeof log.data === "string" 
            ? log.data 
            : JSON.stringify(log.data, null, 2)}
        </div>
      )}
    </div>
  );
}
