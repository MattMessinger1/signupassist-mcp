import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, formatISO } from "date-fns";
import { AlertCircle, BarChart3, DatabaseZap, ExternalLink, FileText, Loader2, Shield } from "lucide-react";

import { Header } from "@/components/Header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import NotFound from "@/pages/NotFound";

type AdminMetrics = {
  window: { from: string; to: string };
  audit_events: {
    total: number;
    allowed: number;
    denied: number;
    pending: number;
    success_rate: number | null;
  };
  unique_users: number;
  top_tools: Array<{ tool: string; count: number; allowed: number; denied: number }>;
  top_providers: Array<{ provider: string; count: number; allowed: number; denied: number }>;
};

type AuditEventRow = {
  id: string;
  created_at: string;
  event_type: string;
  provider: string | null;
  org_ref: string | null;
  tool: string | null;
  decision: "pending" | "allowed" | "denied" | null;
  user_id: string | null;
  plan_execution_id: string | null;
  mandate_id: string | null;
};

type AuditEventsResponse = {
  events: AuditEventRow[];
  next_offset: number | null;
};

function envBool(key: string): boolean {
  // Vite envs must be prefixed with VITE_ to be exposed to the client.
  const v = (import.meta as any)?.env?.[key];
  return String(v || "").toLowerCase() === "true";
}

function envStr(key: string): string {
  const v = (import.meta as any)?.env?.[key];
  return typeof v === "string" ? v : "";
}

function trimId(id?: string | null): string {
  if (!id) return "";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

async function fetchAdminJson<T>(baseUrl: string, path: string, accessToken: string): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = text ? `${res.status}: ${text}` : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export default function AdminConsole() {
  const { user, session, loading } = useAuth();
  const navigate = useNavigate();

  const enabled = envBool("VITE_ADMIN_CONSOLE_ENABLED");
  const apiBaseUrl = envStr("VITE_ADMIN_API_BASE_URL");

  const [auditSearch, setAuditSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [limit, setLimit] = useState<number>(100);

  const hasSession = !!session?.access_token;

  // Redirect (side-effect) only after render.
  // This avoids calling navigate() during render and keeps hooks unconditional.
  useEffect(() => {
    if (!enabled) return;
    if (loading) return;
    if (!user || !session) navigate("/auth");
  }, [enabled, loading, user, session, navigate]);

  const metricsQuery = useQuery({
    queryKey: ["admin-metrics", apiBaseUrl],
    enabled: enabled && !!apiBaseUrl && hasSession,
    queryFn: () => fetchAdminJson<AdminMetrics>(apiBaseUrl, "/admin/api/metrics", session!.access_token),
    staleTime: 30_000,
  });

  const auditQueryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(10, Math.min(500, limit))));
    if (auditSearch.trim()) params.set("q", auditSearch.trim());
    if (decisionFilter !== "all") params.set("decision", decisionFilter);
    if (providerFilter !== "all") params.set("provider", providerFilter);
    if (toolFilter !== "all") params.set("tool", toolFilter);
    return `?${params.toString()}`;
  }, [auditSearch, decisionFilter, providerFilter, toolFilter, limit]);

  const auditEventsQuery = useQuery({
    queryKey: ["admin-audit-events", apiBaseUrl, auditQueryString],
    enabled: enabled && !!apiBaseUrl && hasSession,
    queryFn: () =>
      fetchAdminJson<AuditEventsResponse>(
        apiBaseUrl,
        `/admin/api/audit-events${auditQueryString}`,
        session!.access_token,
      ),
    staleTime: 10_000,
  });

  // Hard gate: if the console is disabled, behave like it doesn't exist.
  if (!enabled) return <NotFound />;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!user || !session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Redirecting to sign in…
        </div>
      </div>
    );
  }

  const adminLinks = [
    { label: "PostHog", href: envStr("VITE_POSTHOG_PROJECT_URL") },
    { label: "Sentry", href: envStr("VITE_SENTRY_PROJECT_URL") },
  ].filter((l) => !!l.href);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">Admin Console</h1>
              <p className="text-muted-foreground">
                Operational visibility across tool calls, integrations, and reliability.
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              <Shield className="h-3.5 w-3.5 mr-1" />
              Preview-only
            </Badge>
          </div>

          {!apiBaseUrl && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Missing <code>VITE_ADMIN_API_BASE_URL</code>. Set it to your MCP server base URL (e.g.,{" "}
                <code>https://&lt;railway-domain&gt;</code>) so the admin console can query metrics.
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="audit" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Audit explorer
              </TabsTrigger>
              <TabsTrigger value="links" className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                Links
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-6">
              {metricsQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {metricsQuery.error instanceof Error ? metricsQuery.error.message : "Failed to load metrics"}
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Tool calls (24h)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{metricsQuery.data?.audit_events.total ?? "—"}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Window:{" "}
                      {metricsQuery.data?.window?.from
                        ? formatDistanceToNow(new Date(metricsQuery.data.window.from), { addSuffix: true })
                        : "—"}{" "}
                      → now
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Success rate</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {metricsQuery.data?.audit_events.success_rate == null
                        ? "—"
                        : `${Math.round(metricsQuery.data.audit_events.success_rate * 100)}%`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Allowed {metricsQuery.data?.audit_events.allowed ?? "—"} / Denied{" "}
                      {metricsQuery.data?.audit_events.denied ?? "—"}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Unique users (24h)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{metricsQuery.data?.unique_users ?? "—"}</div>
                    <div className="text-xs text-muted-foreground mt-1">Based on audit event user_id</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Data source</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-medium flex items-center gap-2">
                      <DatabaseZap className="h-4 w-4" />
                      Supabase `audit_events`
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Redacted + hashed args/results</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Top tools (24h)</CardTitle>
                    <CardDescription>Most-invoked tools, with allow/deny breakdown</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(metricsQuery.data?.top_tools?.length || 0) === 0 ? (
                      <div className="text-sm text-muted-foreground">No data yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {metricsQuery.data?.top_tools?.slice(0, 10).map((t) => (
                          <div key={t.tool} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium truncate">{t.tool}</span>
                            <div className="flex items-center gap-2 text-xs">
                              <Badge variant="secondary">{t.count}</Badge>
                              <Badge variant="outline">✅ {t.allowed}</Badge>
                              <Badge variant="outline">⛔ {t.denied}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Top providers (24h)</CardTitle>
                    <CardDescription>Traffic by provider integration</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(metricsQuery.data?.top_providers?.length || 0) === 0 ? (
                      <div className="text-sm text-muted-foreground">No data yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {metricsQuery.data?.top_providers?.slice(0, 10).map((p) => (
                          <div key={p.provider} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium truncate">{p.provider}</span>
                            <div className="flex items-center gap-2 text-xs">
                              <Badge variant="secondary">{p.count}</Badge>
                              <Badge variant="outline">✅ {p.allowed}</Badge>
                              <Badge variant="outline">⛔ {p.denied}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="audit" className="space-y-4 mt-6">
              {auditEventsQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {auditEventsQuery.error instanceof Error ? auditEventsQuery.error.message : "Failed to load events"}
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Audit events</CardTitle>
                  <CardDescription>Search tool calls across users (admin-only)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                    <Input
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search (tool, provider, user_id)…"
                    />

                    <Select value={decisionFilter} onValueChange={setDecisionFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Decision" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All decisions</SelectItem>
                        <SelectItem value="allowed">Allowed</SelectItem>
                        <SelectItem value="denied">Denied</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={providerFilter} onValueChange={setProviderFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All providers</SelectItem>
                        {(metricsQuery.data?.top_providers || []).map((p) => (
                          <SelectItem key={p.provider} value={p.provider}>
                            {p.provider}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={toolFilter} onValueChange={setToolFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Tool" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All tools</SelectItem>
                        {(metricsQuery.data?.top_tools || []).map((t) => (
                          <SelectItem key={t.tool} value={t.tool}>
                            {t.tool}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={String(limit)} onValueChange={(v) => setLimit(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Limit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {auditEventsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>At</TableHead>
                          <TableHead>Decision</TableHead>
                          <TableHead>Tool</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Mandate</TableHead>
                          <TableHead>Plan exec</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(auditEventsQuery.data?.events || []).map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="whitespace-nowrap">
                              <div className="text-xs text-muted-foreground">{formatISO(new Date(e.created_at))}</div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  e.decision === "allowed"
                                    ? "default"
                                    : e.decision === "denied"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {e.decision || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{e.tool || e.event_type}</TableCell>
                            <TableCell>{e.provider || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{trimId(e.user_id) || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{trimId(e.mandate_id) || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {trimId(e.plan_execution_id) || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Showing {(auditEventsQuery.data?.events || []).length} events</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAuditSearch("");
                        setDecisionFilter("all");
                        setProviderFilter("all");
                        setToolFilter("all");
                        setLimit(100);
                      }}
                    >
                      Reset
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="links" className="space-y-4 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>External dashboards</CardTitle>
                  <CardDescription>Open PostHog / Sentry in a new tab for deeper analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {adminLinks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      Add <code>VITE_POSTHOG_PROJECT_URL</code> and/or <code>VITE_SENTRY_PROJECT_URL</code> to show quick links.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {adminLinks.map((l) => (
                        <Button key={l.label} variant="outline" asChild>
                          <a href={l.href} target="_blank" rel="noreferrer">
                            {l.label} <ExternalLink className="h-4 w-4 ml-2" />
                          </a>
                        </Button>
                      ))}
                    </div>
                  )}

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      This console is intentionally <strong>preview-only</strong>. Production remains untouched until you
                      decide to deploy.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}


