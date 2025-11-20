import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const DOCKERFILE_BUILD_TAG = "b9e7276"; // From Dockerfile ARG BUILD_TAG

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
  const isAligned = railwayCommit === DOCKERFILE_BUILD_TAG;
  
  const StatusIcon = isAligned ? CheckCircle : AlertCircle;
  const statusColor = isAligned ? "text-green-600" : "text-amber-600";
  const statusBadge = isAligned ? "default" : "destructive";

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
              <span className="text-muted-foreground">Dockerfile BUILD_TAG:</span>
              <Badge variant="outline" className="font-mono">
                {DOCKERFILE_BUILD_TAG}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Railway Deployment:</span>
              <Badge variant="outline" className="font-mono">
                {loading ? "..." : railwayCommit}
              </Badge>
            </div>
            
            <div className="pt-2 border-t">
              <div className={`flex items-center gap-2 text-sm ${statusColor}`}>
                <StatusIcon className="h-4 w-4" />
                <span className="font-medium">
                  {isAligned ? "✓ Versions Aligned" : "⚠ Version Mismatch Detected"}
                </span>
              </div>
              
              {!isAligned && (
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <p>• Dockerfile expects: <code className="bg-muted px-1 py-0.5 rounded">{DOCKERFILE_BUILD_TAG}</code></p>
                  <p>• Railway deployed: <code className="bg-muted px-1 py-0.5 rounded">{railwayCommit}</code></p>
                  <p className="text-amber-600 mt-2">
                    Push latest changes to GitHub main branch to trigger Railway deployment.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
