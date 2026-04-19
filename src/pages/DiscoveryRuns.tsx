import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Calendar, Database, FileJson, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { PROVIDER_REGISTRY, getProviderReadinessSummary } from "@/lib/providerLearning";
import { redactDiscoveryRunDetail } from "@/lib/discoveryRunRedaction";

interface DiscoveryRun {
  id: string;
  provider_slug: string;
  program_key: string;
  stage: string;
  run_confidence: number;
  errors: unknown;
  meta: unknown;
  created_at: string;
}

export default function DiscoveryRuns() {
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<DiscoveryRun | null>(null);
  const { toast } = useToast();
  const latestRunsByProvider = runs.reduce<Record<string, DiscoveryRun | undefined>>((acc, run) => {
    if (!acc[run.provider_slug]) acc[run.provider_slug] = run;
    return acc;
  }, {});

  const fetchRuns = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("discovery_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setRuns(data || []);
    } catch (error) {
      console.error("Error fetching discovery runs:", error);
      toast({
        title: "Error",
        description: "Failed to load discovery runs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const getFieldCount = (errors: unknown): number => {
    if (!errors || !Array.isArray(errors)) return 0;
    return errors.length;
  };

  const getConfidenceBadgeVariant = (confidence: number) => {
    if (confidence >= 0.8) return "default";
    if (confidence >= 0.5) return "secondary";
    return "destructive";
  };

  const getStageBadgeVariant = (stage: string) => {
    return stage === "prerequisites" ? "outline" : "default";
  };

  const getReadinessBadgeVariant = (level: string) => {
    if (level === "navigation_verified") return "default";
    if (level === "fill_safe" || level === "recognized") return "secondary";
    return "outline";
  };

  if (loading) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-muted-foreground">Loading discovery runs...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Discovery Runs</h1>
        <p className="text-muted-foreground">
          View provider readiness, mapped fixtures, and the last 50 redacted field discovery runs.
        </p>
      </div>

      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-semibold">Provider readiness</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDER_REGISTRY.map((provider) => {
            const summary = getProviderReadinessSummary(provider.key);
            const latestRun = latestRunsByProvider[provider.key];
            return (
              <Card key={provider.key} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {provider.domains.length ? provider.domains.join(", ") : "Generic fallback"}
                      </p>
                    </div>
                    <Badge variant={getReadinessBadgeVariant(summary.readinessLevel)}>
                      {summary.readinessLevel}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="font-medium">{Math.round(summary.confidenceScore * 100)}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Playbook</span>
                    <span className="max-w-[14rem] truncate font-mono text-xs">
                      {summary.activePlaybookVersion}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Fixtures</span>
                    <span className="font-medium">{summary.fixtureCoverage.coverageLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Live automation</span>
                    <span className="font-medium">{summary.automationPolicy.label}</span>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5" />
                      Latest redacted observation
                    </div>
                    {latestRun ? (
                      <p className="text-xs text-muted-foreground">
                        {latestRun.stage} run {formatDistanceToNow(new Date(latestRun.created_at), { addSuffix: true })}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No redacted discovery observation recorded yet.
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Promotion requires fixtures, provider-specific tests, admin review, and provider automation permission. Model output cannot promote readiness.
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">No discovery runs found</p>
            <p className="text-sm text-muted-foreground">
              Discovery runs will appear here once field discovery has been executed
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {runs.map((run) => (
            <Card key={run.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2">
                      {run.provider_slug} / {run.program_key}
                    </CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={getStageBadgeVariant(run.stage)}>
                        {run.stage}
                      </Badge>
                      <Badge variant={getConfidenceBadgeVariant(run.run_confidence)}>
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {(run.run_confidence * 100).toFixed(0)}% confidence
                      </Badge>
                      <Badge variant="outline">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {getFieldCount(run.errors)} fields
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4 mr-1" />
                      {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedRun(run)}
                    >
                      <FileJson className="h-4 w-4 mr-2" />
                      View redacted JSON
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Error Details Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Discovery Run Details</DialogTitle>
          </DialogHeader>
          {selectedRun && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Provider:</span>{" "}
                  {selectedRun.provider_slug}
                </div>
                <div>
                  <span className="font-medium">Program:</span>{" "}
                  {selectedRun.program_key}
                </div>
                <div>
                  <span className="font-medium">Stage:</span>{" "}
                  <Badge variant={getStageBadgeVariant(selectedRun.stage)}>
                    {selectedRun.stage}
                  </Badge>
                </div>
                <div>
                  <span className="font-medium">Confidence:</span>{" "}
                  {(selectedRun.run_confidence * 100).toFixed(1)}%
                </div>
                <div className="col-span-2">
                  <span className="font-medium">Created:</span>{" "}
                  {new Date(selectedRun.created_at).toLocaleString()}
                </div>
              </div>

              <div>
                <h3 className="font-medium mb-2">Redacted errors (JSON)</h3>
                <ScrollArea className="h-[300px] w-full rounded-md border p-4">
                  <pre className="text-xs">
                    {JSON.stringify(redactDiscoveryRunDetail(selectedRun.errors), null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <div>
                <h3 className="font-medium mb-2">Redacted metadata (JSON)</h3>
                <ScrollArea className="h-[200px] w-full rounded-md border p-4">
                  <pre className="text-xs">
                    {JSON.stringify(redactDiscoveryRunDetail(selectedRun.meta), null, 2)}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
