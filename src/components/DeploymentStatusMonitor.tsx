import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Note: Dockerfile BUILD_TAG is now dynamic (set by Railway), not hardcoded
// This component compares frontend expectations vs Railway's actual deployment

interface BackendInfo {
  env: string;
  git_commit: string;
  timestamp: string;
  backend: string;
}

export function DeploymentStatusMonitor() {
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBackendInfo = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const baseUrl = import.meta.env.VITE_MCP_BASE_URL;
      const res = await fetch(`${baseUrl}/identity`);
      
      if (!res.ok) {
        throw new Error(`Backend returned ${res.status}`);
      }
      
      const data = await res.json();
      setBackendInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch backend info");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackendInfo();
  }, []);

  const railwayCommit = backendInfo?.git_commit?.substring(0, 7) || "unknown";
  const railwayTimestamp = backendInfo?.timestamp 
    ? new Date(backendInfo.timestamp).toLocaleString()
    : "unknown";
  
  const isHealthy = backendInfo !== null;
  const StatusIcon = isHealthy ? CheckCircle : AlertCircle;
  const statusColor = isHealthy ? "text-green-600" : "text-amber-600";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">Deployment Status</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchBackendInfo}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Railway Commit:</span>
              <Badge variant="outline" className="font-mono">
                {loading ? "..." : railwayCommit}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Deployed At:</span>
              <span className="text-xs text-muted-foreground">
                {loading ? "..." : railwayTimestamp}
              </span>
            </div>
            
            <div className="pt-2 border-t">
              <div className={`flex items-center gap-2 text-sm ${statusColor}`}>
                <StatusIcon className="h-4 w-4" />
                <span className="font-medium">
                  {isHealthy ? "✓ Backend Healthy" : "⚠ Backend Unreachable"}
                </span>
              </div>
              
              {isHealthy && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>Backend version is automatically set by Railway from git commit SHA.</p>
                  <p className="mt-1">Push to <code className="bg-muted px-1 py-0.5 rounded">main</code> branch to deploy updates.</p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
