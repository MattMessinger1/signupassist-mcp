import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  PauseCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { findPlaybookByKey } from "@/lib/autopilot/playbooks";
import { buildAutopilotRunPacket, buildPreflightState, type AutopilotRunPacket } from "@/lib/autopilot/runPacket";
import { launchHelperOrRedirect } from "@/lib/chromeHelperBridge";
import { buildAutopilotIntentPath } from "@/lib/signupIntent";
import {
  isCompleteStatus,
  isPausedStatus,
  normalizeRunStatus,
  runStatusLabel,
} from "@/lib/dashboardStatus";
import { showErrorToast } from "@/lib/toastHelpers";

type RunCenterRun = Database["public"]["Tables"]["autopilot_runs"]["Row"] & {
  children?: {
    first_name: string;
    last_name: string;
  } | null;
};

type RunTab = "ready" | "opening_soon" | "needs_you" | "done";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childLabel(run: RunCenterRun) {
  if (!run.children) return "Choose child";
  return `${run.children.first_name} ${run.children.last_name || ""}`.trim();
}

function capsRecord(run: RunCenterRun) {
  return isRecord(run.caps) ? run.caps : {};
}

function stringFromCaps(run: RunCenterRun, key: string) {
  const value = capsRecord(run)[key];
  return typeof value === "string" ? value : null;
}

function registrationOpensAt(run: RunCenterRun) {
  return stringFromCaps(run, "registration_opens_at");
}

function reminderLabel(run: RunCenterRun) {
  const reminder = capsRecord(run).reminder;
  if (!isRecord(reminder)) return "Reminder not configured";
  const minutes = typeof reminder.minutesBefore === "number" ? reminder.minutesBefore : 10;
  const channels = Array.isArray(reminder.channels)
    ? reminder.channels.filter((item): item is string => typeof item === "string")
    : ["email"];
  return `${minutes} minutes before by ${channels.join(", ") || "email"}`;
}

function formatWindow(value?: string | null) {
  if (!value) return "Window not set";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, "MMM d, p") : "Window not set";
}

function isOpeningSoon(run: RunCenterRun) {
  const opensAt = registrationOpensAt(run);
  if (!opensAt || isCompleteStatus(run.status) || isPausedStatus(run.status)) return false;
  const opensTime = new Date(opensAt).getTime();
  if (!Number.isFinite(opensTime)) return false;
  const now = Date.now();
  return opensTime >= now && opensTime <= now + 1000 * 60 * 60 * 72;
}

function tabForRun(run: RunCenterRun): RunTab {
  if (isCompleteStatus(run.status)) return "done";
  if (isPausedStatus(run.status)) return "needs_you";
  if (isOpeningSoon(run)) return "opening_soon";
  return "ready";
}

function signupIntentId(run: RunCenterRun) {
  const providerLearning = capsRecord(run).provider_learning;
  if (!isRecord(providerLearning)) return null;
  const value = providerLearning.signup_intent_id;
  return typeof value === "string" ? value : null;
}

function reviewPath(run: RunCenterRun) {
  const intentId = signupIntentId(run);
  return intentId ? buildAutopilotIntentPath(intentId) : "/activity-finder";
}

function runPacket(run: RunCenterRun): AutopilotRunPacket {
  const caps = capsRecord(run);
  const packet = caps.run_packet;
  if (isRecord(packet)) return packet as unknown as AutopilotRunPacket;

  const playbook = findPlaybookByKey(run.provider_key || "generic");
  const reminder = isRecord(caps.reminder) ? caps.reminder : {};
  const preflight = isRecord(caps.preflight)
    ? buildPreflightState(caps.preflight)
    : buildPreflightState({ targetUrlConfirmed: true });

  return buildAutopilotRunPacket({
    playbook,
    targetUrl: run.target_url,
    targetProgram: run.target_program,
    registrationOpensAt: registrationOpensAt(run),
    maxTotalCents: typeof caps.max_total_cents === "number" ? caps.max_total_cents : null,
    participantAgeYears: typeof caps.participant_age_years === "number" ? caps.participant_age_years : null,
    finder: isRecord(caps.finder) ? caps.finder : null,
    reminder: {
      minutesBefore: typeof reminder.minutesBefore === "number" ? reminder.minutesBefore : 10,
      channels: Array.isArray(reminder.channels)
        ? reminder.channels.filter((channel): channel is string => typeof channel === "string")
        : ["email"],
      phoneNumber: null,
    },
    child: run.child_id ? { id: run.child_id, name: childLabel(run) } : null,
    preflight,
  });
}

function statusPill(run: RunCenterRun) {
  const tab = tabForRun(run);
  if (tab === "ready") return "Helper ready";
  if (tab === "opening_soon") return "Opening soon";
  if (tab === "needs_you") return "Needs you";
  return runStatusLabel(run.status);
}

function RunCard({
  run,
  onLaunch,
  onReview,
}: {
  run: RunCenterRun;
  onLaunch: (run: RunCenterRun) => void;
  onReview: (run: RunCenterRun) => void;
}) {
  const tab = tabForRun(run);
  const opensAt = registrationOpensAt(run);
  const providerHost = (() => {
    try {
      return new URL(run.target_url).hostname.replace(/^www\./, "");
    } catch {
      return run.provider_name;
    }
  })();

  return (
    <Card className="shadow-sm">
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.3fr)_1fr_1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h2 className="line-clamp-1 font-semibold">{run.target_program || "Prepared signup plan"}</h2>
              <p className="text-sm text-muted-foreground">{childLabel(run)}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{run.provider_name} • {providerHost}</p>
        </div>

        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Reminder</p>
          <p className="mt-1 text-sm font-semibold">{reminderLabel(run)}</p>
        </div>

        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Opening window</p>
          <p className="mt-1 text-sm font-semibold">{formatWindow(opensAt)}</p>
        </div>

        <div className="flex flex-col gap-2 lg:min-w-44">
          <Badge className="justify-center" variant={tab === "needs_you" ? "destructive" : "secondary"}>
            {statusPill(run)}
          </Badge>
          {tab === "ready" ? (
            <Button onClick={() => onLaunch(run)}>
              <Play className="h-4 w-4" />
              Launch helper
            </Button>
          ) : tab === "done" ? (
            <Button variant="outline" onClick={() => onReview(run)}>
              <CheckCircle2 className="h-4 w-4" />
              Receipt / history
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onReview(run)}>
              {tab === "needs_you" ? <PauseCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              Review
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={run.target_url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open provider
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RunCenter() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<RunCenterRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [launchingRunId, setLaunchingRunId] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("autopilot_runs")
        .select("*, children:child_id (first_name, last_name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRuns((data || []) as RunCenterRun[]);
    } catch (error) {
      showErrorToast(
        "Run Center unavailable",
        error instanceof Error ? error.message : "Could not load prepared plans.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?returnTo=%2Frun-center");
    } else if (user) {
      void loadRuns();
    }
  }, [authLoading, loadRuns, navigate, user]);

  const grouped = useMemo(() => {
    const initial: Record<RunTab, RunCenterRun[]> = {
      ready: [],
      opening_soon: [],
      needs_you: [],
      done: [],
    };
    runs.forEach((run) => initial[tabForRun(run)].push(run));
    return initial;
  }, [runs]);

  const launchRun = async (run: RunCenterRun) => {
    setLaunchingRunId(run.id);
    try {
      await launchHelperOrRedirect({
        packet: runPacket(run),
        providerUrl: run.target_url,
        returnTo: "/run-center",
        navigate,
      });
    } finally {
      setLaunchingRunId(null);
    }
  };

  const reviewRun = (run: RunCenterRun) => {
    navigate(reviewPath(run));
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-normal text-primary">Run Center</h1>
            <p className="mt-2 text-muted-foreground">
              Launch helper, review pauses, and track your prepared signups.
            </p>
          </div>
          <Button onClick={() => navigate("/activity-finder")}>
            Find Activity
          </Button>
        </div>

        <Alert className="mb-6 border-primary/20">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-sm">SignupAssist only runs when you launch a helper. Sensitive steps still pause.</span>
        </Alert>

        <Tabs defaultValue="ready" className="space-y-5">
          <TabsList className="grid h-auto grid-cols-2 md:grid-cols-4">
            <TabsTrigger value="ready">Ready ({grouped.ready.length})</TabsTrigger>
            <TabsTrigger value="opening_soon">Opening soon ({grouped.opening_soon.length})</TabsTrigger>
            <TabsTrigger value="needs_you">Needs you ({grouped.needs_you.length})</TabsTrigger>
            <TabsTrigger value="done">Done ({grouped.done.length})</TabsTrigger>
          </TabsList>

          {(["ready", "opening_soon", "needs_you", "done"] as RunTab[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="space-y-3">
              {grouped[tab].length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    {tab === "ready"
                      ? "No ready plans yet. Find an activity to prepare one."
                      : "Nothing here right now."}
                  </CardContent>
                </Card>
              ) : (
                grouped[tab].map((run) => (
                  <div key={run.id} className={launchingRunId === run.id ? "opacity-70" : ""}>
                    <RunCard run={run} onLaunch={launchRun} onReview={reviewRun} />
                  </div>
                ))
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
