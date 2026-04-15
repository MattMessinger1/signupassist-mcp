import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  Play,
  ShieldCheck,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BillingCard } from "@/components/BillingCard";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  DEFAULT_ALLOWED_ACTIONS,
  DEFAULT_STOP_CONDITIONS,
  PROVIDER_PLAYBOOKS,
  findPlaybookByKey,
  findPlaybookForUrl,
} from "@/lib/autopilot/playbooks";
import { buildAutopilotAuditEvent, detectProviderMismatch } from "@/lib/autopilot/classifier";
import {
  AUTOPILOT_PRICE_LABEL,
  isAutopilotSubscriptionUsable,
  type UserSubscription,
} from "@/lib/subscription";
import { showErrorToast, showSuccessToast } from "@/lib/toastHelpers";

type ChildRow = Pick<
  Database["public"]["Tables"]["children"]["Row"],
  "id" | "first_name" | "last_name" | "dob"
>;

type AutopilotRun = Database["public"]["Tables"]["autopilot_runs"]["Row"];

const centsFromDollarInput = (value: string) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.round(numericValue * 100);
};

export default function Autopilot() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [providerKey, setProviderKey] = useState("active");
  const [childId, setChildId] = useState("none");
  const [targetProgram, setTargetProgram] = useState("");
  const [priceCap, setPriceCap] = useState("250");
  const [loadingData, setLoadingData] = useState(true);
  const [creatingRun, setCreatingRun] = useState(false);

  const selectedPlaybook = useMemo(() => findPlaybookByKey(providerKey), [providerKey]);
  const detectedPlaybook = useMemo(
    () => (targetUrl ? findPlaybookForUrl(targetUrl) : null),
    [targetUrl],
  );
  const subscriptionUsable = isAutopilotSubscriptionUsable(subscription);
  const providerMismatch =
    targetUrl && selectedPlaybook ? detectProviderMismatch(targetUrl, selectedPlaybook) : false;
  const latestCompletedRun = runs.find((run) => run.status === "completed");

  const loadAutopilotData = useCallback(async () => {
    if (!user) return;

    try {
      setLoadingData(true);
      const [childrenResult, runsResult] = await Promise.all([
        supabase
          .from("children")
          .select("id, first_name, last_name, dob")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("autopilot_runs")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      if (childrenResult.error) throw childrenResult.error;
      if (runsResult.error) throw runsResult.error;

      setChildren(childrenResult.data || []);
      setRuns(runsResult.data || []);
    } catch (error) {
      showErrorToast(
        "Autopilot data unavailable",
        error instanceof Error ? error.message : "Unable to load autopilot setup.",
      );
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    } else if (user) {
      loadAutopilotData();
    }
  }, [authLoading, loadAutopilotData, navigate, user]);

  const detectProvider = () => {
    if (!targetUrl) return;
    const playbook = findPlaybookForUrl(targetUrl);
    setProviderKey(playbook.key);
  };

  const createRun = async () => {
    if (!user) return;

    if (!subscriptionUsable) {
      showErrorToast(
        "Membership required",
        `Start ${AUTOPILOT_PRICE_LABEL} before creating a real supervised autopilot run.`,
      );
      return;
    }

    if (!targetUrl.trim()) {
      showErrorToast("Provider URL required", "Add the signup page URL before starting.");
      return;
    }

    if (providerMismatch) {
      showErrorToast(
        "Provider mismatch",
        "The selected provider does not match the signup URL. Detect the provider or choose generic beta.",
      );
      return;
    }

    const maxTotalCents = centsFromDollarInput(priceCap);

    try {
      setCreatingRun(true);

      const playbook = findPlaybookByKey(providerKey);
      const runInsert = {
        user_id: user.id,
        provider_key: playbook.key,
        provider_name: playbook.name,
        target_url: targetUrl.trim(),
        target_program: targetProgram.trim() || null,
        child_id: childId === "none" ? null : childId,
        status: "ready",
        confidence: playbook.confidence,
        caps: { max_total_cents: maxTotalCents } as Json,
        allowed_actions: playbook.allowedActions as unknown as Json,
        stop_conditions: playbook.stopConditions as unknown as Json,
        audit_events: [
          buildAutopilotAuditEvent("run_created", {
            provider_key: playbook.key,
            target_url: targetUrl.trim(),
            target_program: targetProgram.trim() || null,
            max_total_cents: maxTotalCents,
          }),
        ] as unknown as Json,
      };

      const { error } = await supabase.from("autopilot_runs").insert(runInsert);
      if (error) throw error;

      showSuccessToast("Autopilot run ready", "Open the Chrome helper when registration opens.");
      setTargetUrl("");
      setTargetProgram("");
      await loadAutopilotData();
    } catch (error) {
      showErrorToast(
        "Could not create run",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setCreatingRun(false);
    }
  };

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Loading supervised autopilot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">
              Chrome desktop first
            </Badge>
            <h1 className="text-3xl font-bold">Supervised Autopilot</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Move fast when registration opens. SignupAssist fills the tedious parts, you approve the important parts, and cancellation is always one click away.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            <Clock3 className="h-4 w-4" />
            Scheduled runs
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Run setup
                </CardTitle>
                <CardDescription>
                  Verified providers get the speed path. Unknown providers run in conservative beta mode.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!subscriptionUsable && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Membership gate</AlertTitle>
                    <AlertDescription>
                      Real supervised autopilot runs require an active {AUTOPILOT_PRICE_LABEL} membership.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="target-url">Provider signup URL</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="target-url"
                        value={targetUrl}
                        onChange={(event) => setTargetUrl(event.target.value)}
                        placeholder="https://..."
                      />
                      <Button type="button" variant="outline" onClick={detectProvider}>
                        Detect provider
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Provider playbook</Label>
                    <Select value={providerKey} onValueChange={setProviderKey}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDER_PLAYBOOKS.map((playbook) => (
                          <SelectItem key={playbook.key} value={playbook.key}>
                            {playbook.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Child profile</Label>
                    <Select value={childId} onValueChange={setChildId}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose during run</SelectItem>
                        {children.map((child) => (
                          <SelectItem key={child.id} value={child.id}>
                            {child.first_name} {child.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target-program">Program or session</Label>
                    <Input
                      id="target-program"
                      value={targetProgram}
                      onChange={(event) => setTargetProgram(event.target.value)}
                      placeholder="U8 soccer, July camp, 9am swim..."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price-cap">Price cap</Label>
                    <Input
                      id="price-cap"
                      inputMode="decimal"
                      value={priceCap}
                      onChange={(event) => setPriceCap(event.target.value)}
                      placeholder="250"
                    />
                  </div>
                </div>

                {detectedPlaybook && detectedPlaybook.key !== "generic" && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Detected {detectedPlaybook.name}. Speed claims apply only when the selected provider is verified.
                    </AlertDescription>
                  </Alert>
                )}

                {providerMismatch && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      The URL appears to be {detectedPlaybook?.name}, but the selected playbook is {selectedPlaybook.name}.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={createRun} disabled={creatingRun || !subscriptionUsable}>
                    {creatingRun ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating run...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        Create supervised run
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/credentials")}>
                    <UserRound className="h-4 w-4" />
                    Family profiles
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {PROVIDER_PLAYBOOKS.filter((playbook) => playbook.key !== "generic").map((playbook) => (
                <Card key={playbook.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-base">{playbook.name}</CardTitle>
                      <Badge variant="default">Verified</Badge>
                    </div>
                    <CardDescription>{playbook.speedClaim}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>

          <aside className="space-y-6">
            <BillingCard
              userId={user?.id}
              returnPath="/autopilot"
              onSubscriptionChange={setSubscription}
              showPostRunActions={Boolean(latestCompletedRun)}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PauseCircle className="h-5 w-5" />
                  Pause rules
                </CardTitle>
                <CardDescription>Parent approval stays in front of high-risk actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium">Allowed</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {DEFAULT_ALLOWED_ACTIONS.slice(0, 4).map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">Always pauses</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {DEFAULT_STOP_CONDITIONS.slice(0, 7).map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Run history</CardTitle>
                <CardDescription>Recent supervised autopilot setup records.</CardDescription>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No supervised runs yet.</p>
                ) : (
                  <div className="space-y-3">
                    {runs.map((run) => (
                      <div key={run.id} className="border-b pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{run.provider_name}</p>
                          <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                            {run.status}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {run.target_program || run.target_url}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
