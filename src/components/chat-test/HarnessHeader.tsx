/**
 * HarnessHeader Component
 * 
 * Header for the test harness showing:
 * - Title and description
 * - MCP connection status
 * - Action buttons (Run Demo, Reset)
 */

import { Play, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HarnessHeaderProps {
  mcpConnected: boolean;
  isDemoRunning: boolean;
  isProcessing: boolean;
  onRunDemo: () => void;
  onReset: () => void;
  onRefreshCache?: () => void;
  isRefreshingCache?: boolean;
}

export function HarnessHeader({
  mcpConnected,
  isDemoRunning,
  isProcessing,
  onRunDemo,
  onReset,
  onRefreshCache,
  isRefreshingCache = false,
}: HarnessHeaderProps) {
  return (
    <div className="border-b bg-card px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">SignupAssist Test Harness</h1>
          <p className="text-sm text-muted-foreground">ChatGPT-style conversation simulator</p>
        </div>
        <div className="flex items-center gap-2">
          {onRefreshCache && (
            <Button
              onClick={onRefreshCache}
              disabled={isProcessing || isRefreshingCache}
              size="sm"
              variant="ghost"
              className="gap-2"
              title="Refresh program cache with real data"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshingCache && "animate-spin")} />
              {isRefreshingCache ? "Refreshing..." : "Refresh Cache"}
            </Button>
          )}
          <Button
            onClick={onReset}
            disabled={isProcessing}
            size="sm"
            variant="ghost"
            className="gap-2"
            title="Reset conversation"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            onClick={onRunDemo}
            disabled={!mcpConnected || isDemoRunning || isProcessing}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            {isDemoRunning ? "Running Demo..." : "Run Demo Flow"}
          </Button>
          <div
            className={cn(
              "flex items-center gap-2 text-xs px-3 py-1 rounded-full",
              mcpConnected
                ? "bg-green-500/10 text-green-700 dark:text-green-400"
                : "bg-red-500/10 text-red-700 dark:text-red-400"
            )}
          >
            <div className={cn("h-2 w-2 rounded-full", mcpConnected ? "bg-green-500" : "bg-red-500")} />
            <span>{mcpConnected ? "MCP Connected" : "MCP Disconnected"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
