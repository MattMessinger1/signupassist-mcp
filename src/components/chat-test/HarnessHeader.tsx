/**
 * HarnessHeader Component
 * 
 * Header for the test harness showing:
 * - Title and description
 * - MCP connection status
 * - Action buttons (Run Demo, Reset)
 */

import { Play, RotateCcw, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface HarnessHeaderProps {
  mcpConnected: boolean;
  isDemoRunning: boolean;
  isProcessing: boolean;
  onRunDemo: () => void;
  onReset: () => void;
  onRefreshCache?: () => void;
  isRefreshingCache?: boolean;
  mcpUrl?: string;
  mockAuthenticated?: boolean;
  onToggleAuth?: () => void;
}

export function HarnessHeader({
  mcpConnected,
  isDemoRunning,
  isProcessing,
  onRunDemo,
  onReset,
  onRefreshCache,
  isRefreshingCache = false,
  mcpUrl,
  mockAuthenticated = false,
  onToggleAuth,
}: HarnessHeaderProps) {
  // Determine if we're in production (Railway) or dev (localhost)
  const isProduction = mcpUrl?.includes('railway.app');
  const isLocalhost = mcpUrl?.includes('localhost');
  const displayUrl = mcpUrl 
    ? (isProduction ? '🚀 Railway Production' : isLocalhost ? '💻 Localhost' : mcpUrl)
    : 'Not configured';
  return (
    <div className="border-b bg-card px-6 py-4 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">SignupAssist Test Harness</h1>
            {mcpUrl && (
              <Badge 
                variant="outline" 
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium",
                  isProduction 
                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" 
                    : "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30"
                )}
              >
                <Server className="h-3 w-3" />
                {displayUrl}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">ChatGPT-style conversation simulator</p>
            {mcpUrl && (
              <span className="text-xs text-muted-foreground/70">
                • {mcpUrl}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onToggleAuth && (
            <Button
              onClick={onToggleAuth}
              size="sm"
              variant={mockAuthenticated ? "default" : "outline"}
              className="gap-2"
              title="Toggle mock authentication state"
            >
              {mockAuthenticated ? "🔓 Authenticated" : "🔒 Unauthenticated"}
            </Button>
          )}
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
