import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { buildAutopilotAuditEvent } from "@/lib/autopilot/classifier";
import { findPlaybookByKey, findPlaybookForUrl } from "@/lib/autopilot/playbooks";
import {
  buildAutopilotRunPacket,
  buildPreflightState,
  type AutopilotRunPacket,
} from "@/lib/autopilot/runPacket";
import { launchHelperOrRedirect } from "@/lib/chromeHelperBridge";
import {
  SET_AND_FORGET_LADDER,
  buildRedactedProviderObservation,
  getProviderReadinessSummary,
} from "@/lib/providerLearning";
import {
  AUTOPILOT_PRICE_LABEL,
  fetchUserSubscription,
  isAutopilotSubscriptionUsable,
  startSubscriptionCheckout,
  type UserSubscription,
} from "@/lib/subscription";
import {
  buildAutopilotIntentPath,
  getSignupIntent,
  updateSignupIntent,
  type SignupIntent,
} from "@/lib/signupIntent";
import { showErrorToast, showSuccessToast } from "@/lib/toastHelpers";

const WEB_API_BASE =
  import.meta.env.VITE_MCP_BASE_URL || import.meta.env.VITE_MCP_SERVER_URL || "";

type ChildRow = Pick<
  Database["public"]["Tables"]["children"]["Row"],
  "id" | "first_name" | "last_name" | "dob"
>;

type AutopilotRunRow = Database["public"]["Tables"]["autopilot_runs"]["Row"];

type PreparePlanVariant = "sheet" | "card";

interface PreparePlanSheetProps {
  intentId: string | null;
  open?: boolean;
  variant?: PreparePlanVariant;
  returnPath?: string;
  onOpenChange?: (open: boolean) => void;
  onPlanSaved?: (runId: string) => void;
}

function webApiUrl(path: string) {
  const base = WEB_API_BASE || window.location.origin;
  return `${base.replace(/\/$/, "")}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function centsFromDollarInput(value: string) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.round(numericValue * 100);
}

function ageYearsFromIntent(intent: SignupIntent | null) {
  const age = intent?.parsed.ageYears;
  return typeof age === "number" && age >= 0 ? age : null;
}

function childLabel(child?: ChildRow | null) {
  if (!child) return "Choose child";
  return `${child.first_name} ${child.last_name || ""}`.trim();
}

function selectedResultString(intent: SignupIntent | null, key: string) {
  const value = intent?.selectedResult[key];
  return typeof value === "string" ? value : "";
}

function targetProgramFromIntent(intent: SignupIntent | null) {
  if (!intent) return "Signup plan";
  const activity = selectedResultString(intent, "activityLabel") || intent.parsed.activity || "";
  const venue = selectedResultString(intent, "venueName") || intent.parsed.venue || "";
  return [activity, venue].filter(Boolean).join(" at ") || venue || activity || "Signup plan";
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && (import.meta.env.PROD || url.protocol !== "http:")) return null;
    if (url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    const privateHost =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^\[?(?:fc|fd)[0-9a-f]{2}:/i.test(hostname) ||
      /^\[?fe80:/i.test(hostname) ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal");
    return privateHost ? null : url.toString();
  } catch {
    return null;
  }
}

function firstStringValue(value: unknown, keys: string[]) {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function finderMetadata(intent: SignupIntent | null) {
  if (!intent) return null;
  const address = selectedResultString(intent, "address") || null;
  const location = intent.parsed.city
    ? [intent.parsed.city, intent.parsed.state].filter(Boolean).join(", ")
    : null;
  return {
    query: intent.originalQuery,
    status: intent.finderStatus,
    venue: intent.parsed.venue || intent.providerName,
    address,
    location,
  };
}

function getRunPacketFromCaps(run: AutopilotRunRow | null) {
  if (!run || !isRecord(run.caps)) return null;
  const packet = run.caps.run_packet;
  return isRecord(packet) ? (packet as unknown as AutopilotRunPacket) : null;
}

function buildExistingRunPacket(run: AutopilotRunRow | null, intent: SignupIntent | null) {
  const packetFromCaps = getRunPacketFromCaps(run);
  if (packetFromCaps) return packetFromCaps;
  if (!run) return null;

  const playbook = findPlaybookByKey(run.provider_key || intent?.providerKey || "generic");
  const caps = isRecord(run.caps) ? run.caps : {};
  const preflight = isRecord(caps.preflight)
    ? buildPreflightState(caps.preflight)
    : buildPreflightState({ targetUrlConfirmed: true });
  const reminder = isRecord(caps.reminder) ? caps.reminder : {};
  const child = intent?.selectedChildId
    ? { id: intent.selectedChildId, name: "Selected child" }
    : null;

  return buildAutopilotRunPacket({
    playbook,
    targetUrl: run.target_url,
    targetProgram: run.target_program,
    registrationOpensAt: typeof caps.registration_opens_at === "string" ? caps.registration_opens_at : null,
    maxTotalCents: typeof caps.max_total_cents === "number" ? caps.max_total_cents : null,
    participantAgeYears: ageYearsFromIntent(intent),
    finder: finderMetadata(intent),
    reminder: {
      minutesBefore: typeof reminder.minutesBefore === "number" ? reminder.minutesBefore : 10,
      channels: Array.isArray(reminder.channels)
        ? reminder.channels.filter((channel): channel is string => typeof channel === "string")
        : ["email"],
      phoneNumber: null,
    },
    child,
    preflight,
  });
}

export function PreparePlanSheet({
  intentId,
  open = true,
  variant = "sheet",
  returnPath,
  onOpenChange,
  onPlanSaved,
}: PreparePlanSheetProps) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [intent, setIntent] = useState<SignupIntent | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [existingRun, setExistingRun] = useState<AutopilotRunRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [helperRequesting, setHelperRequesting] = useState(false);
  const [helperCode, setHelperCode] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [childId, setChildId] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("10");
  const [priceCap, setPriceCap] = useState("250");
  const [providerLink, setProviderLink] = useState("");

  const isCard = variant === "card";
  const currentRunId = existingRun?.id || intent?.autopilotRunId || null;
  const safeProviderUrl = safeExternalUrl(providerLink.trim());
  const playbook = useMemo(
    () => findPlaybookByKey(intent?.providerKey || findPlaybookForUrl(providerLink).key),
    [intent?.providerKey, providerLink],
  );
  const readinessSummary = useMemo(() => getProviderReadinessSummary(playbook.key), [playbook.key]);
  const selectedChild = children.find((child) => child.id === childId) || null;
  const subscriptionUsable = isAutopilotSubscriptionUsable(subscription);
  const intentPath = intentId ? buildAutopilotIntentPath(intentId) : "/run-center";
  const launchReturnPath = returnPath || intentPath;
  const savedPacket = useMemo(() => buildExistingRunPacket(existingRun, intent), [existingRun, intent]);
  const savedProviderUrl = existingRun?.target_url || safeProviderUrl || providerLink;
  const program = targetProgramFromIntent(intent);

  const loadData = useCallback(async () => {
    if (!user || !intentId) return;

    try {
      setLoading(true);
      setFormError(null);
      const loadedIntent = await getSignupIntent(intentId);
      const [childrenResult, subscriptionResult] = await Promise.all([
        supabase
          .from("children")
          .select("id, first_name, last_name, dob")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        fetchUserSubscription(user.id).catch(() => null),
      ]);

      if (childrenResult.error) throw childrenResult.error;

      let run: AutopilotRunRow | null = null;
      if (loadedIntent.autopilotRunId) {
        const runResult = await supabase
          .from("autopilot_runs")
          .select("*")
          .eq("id", loadedIntent.autopilotRunId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (runResult.error) throw runResult.error;
        run = runResult.data;
      }

      setIntent(loadedIntent);
      setChildren(childrenResult.data || []);
      setSubscription(subscriptionResult);
      setExistingRun(run);
      setChildId(loadedIntent.selectedChildId || childrenResult.data?.[0]?.id || "");
      setProviderLink(loadedIntent.targetUrl || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load this plan.";
      setFormError(message);
      showErrorToast("Plan unavailable", message);
    } finally {
      setLoading(false);
    }
  }, [intentId, user]);

  useEffect(() => {
    if (!open || authLoading) return;
    if (!user) {
      navigate(`/auth?returnTo=${encodeURIComponent(returnPath || "/activity-finder")}`);
      return;
    }
    void loadData();
  }, [authLoading, loadData, navigate, open, returnPath, user]);

  const createRunPacket = () => {
    const maxTotalCents = centsFromDollarInput(priceCap);
    return buildAutopilotRunPacket({
      playbook,
      targetUrl: safeProviderUrl || providerLink.trim(),
      targetProgram: program,
      registrationOpensAt: null,
      maxTotalCents,
      participantAgeYears: ageYearsFromIntent(intent),
      finder: finderMetadata(intent),
      reminder: {
        minutesBefore: Number.isFinite(Number(reminderMinutes))
          ? Math.max(1, Math.round(Number(reminderMinutes)))
          : 10,
        channels: ["email"],
        phoneNumber: null,
      },
      child: selectedChild
        ? {
            id: selectedChild.id,
            name: childLabel(selectedChild),
          }
        : null,
      preflight: buildPreflightState({
        childProfileReady: Boolean(selectedChild),
        targetUrlConfirmed: Boolean(safeProviderUrl),
      }),
    });
  };

  const savePlan = async () => {
    if (!user || !intent) return;

    if (currentRunId) {
      showSuccessToast("Plan already saved", "Use Run Center when you are ready to launch helper.");
      return;
    }

    if (!subscriptionUsable) {
      setFormError(`Start ${AUTOPILOT_PRICE_LABEL} before saving a real supervised run.`);
      return;
    }

    if (!childId) {
      setFormError("Choose a child before saving the plan.");
      return;
    }

    if (!safeProviderUrl) {
      setFormError("Add a public HTTPS signup page URL before saving the plan.");
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const packet = createRunPacket();
      const providerLearning = {
        provider_readiness: readinessSummary.readinessLevel,
        confidence: readinessSummary.confidenceScore,
        active_playbook_version: readinessSummary.activePlaybookVersion,
        fixture_coverage: readinessSummary.fixtureCoverage,
        supported_actions: readinessSummary.supportedActions,
        stop_conditions: readinessSummary.stopConditions,
        promotion: readinessSummary.promotionPolicy,
        automation_policy: readinessSummary.automationPolicy,
        opt_in_redacted_learning: false,
        no_child_pii_in_learning: true,
        signup_intent_id: intent.id,
        ladder: SET_AND_FORGET_LADDER,
      };

      const caps = {
        max_total_cents: packet.target.maxTotalCents,
        registration_opens_at: null,
        readiness_score: packet.readiness.score,
        preflight: packet.readiness.checks,
        payment: packet.payment,
        reminder: packet.reminder,
        finder: packet.finder,
        provider_learning: providerLearning,
        participant_age_years: packet.target.participantAgeYears,
        run_packet_version: packet.version,
        run_packet: packet,
      };

      const runInsert = {
        user_id: user.id,
        provider_key: playbook.key,
        provider_name: playbook.name,
        target_url: safeProviderUrl,
        target_program: program,
        child_id: childId,
        status: "ready",
        confidence: playbook.confidence,
        caps: caps as unknown as Json,
        allowed_actions: packet.safety.allowedActions as unknown as Json,
        stop_conditions: packet.safety.stopConditions as unknown as Json,
        audit_events: [
          buildAutopilotAuditEvent("run_created", {
            provider_key: playbook.key,
            target_url: safeProviderUrl,
            target_program: program,
            max_total_cents: packet.target.maxTotalCents,
            readiness_score: packet.readiness.score,
            reminder: packet.reminder,
            finder: packet.finder,
            provider_learning: providerLearning,
          }),
          buildAutopilotAuditEvent("run_packet_created", {
            mode: packet.mode,
            billing: packet.billing,
            payment: packet.payment,
            readiness: packet.readiness,
            set_and_forget_foundation: packet.setAndForgetFoundation,
          }),
        ] as unknown as Json,
      };
      const redactedObservation = buildRedactedProviderObservation(runInsert);
      runInsert.caps = {
        ...caps,
        provider_learning: {
          ...providerLearning,
          redacted_observation_available: true,
          redacted_observation: redactedObservation,
        },
      } as unknown as Json;

      const { data, error } = await supabase
        .from("autopilot_runs")
        .insert(runInsert)
        .select("*")
        .single();
      if (error) throw error;

      const updatedIntent = await updateSignupIntent(intent.id, {
        status: "scheduled",
        autopilot_run_id: data.id,
        selected_child_id: childId,
        target_url: safeProviderUrl,
        provider_key: playbook.key,
        provider_name: playbook.name,
      });
      setIntent(updatedIntent);
      setExistingRun(data);
      onPlanSaved?.(data.id);
      showSuccessToast("Plan saved", "Run Center is ready when you are.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      setFormError(message);
      showErrorToast("Could not save plan", message);
    } finally {
      setSaving(false);
    }
  };

  const requestHelperCode = async () => {
    if (!currentRunId) return;

    try {
      setHelperRequesting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in required");

      const response = await fetch(webApiUrl("/api/helper/run-links"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ autopilotRunId: currentRunId }),
      });
      if (!response.ok) throw new Error(`Helper code request failed (${response.status})`);

      const data = await response.json().catch(() => null);
      const code = firstStringValue(data, ["helper_code", "helperCode", "code"]);
      if (!code) throw new Error("No helper code returned.");
      setHelperCode(code);
      await navigator.clipboard.writeText(code);
      showSuccessToast("Helper code copied", "Paste it into the Chrome helper if automatic launch is unavailable.");
    } catch (error) {
      showErrorToast(
        "Could not get helper code",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setHelperRequesting(false);
    }
  };

  const launchHelper = async () => {
    const packet = savedPacket || createRunPacket();
    if (!packet || !savedProviderUrl) return;

    setLaunching(true);
    const result = await launchHelperOrRedirect({
      packet,
      providerUrl: savedProviderUrl,
      returnTo: launchReturnPath,
      navigate,
    });
    setLaunching(false);

    if (!result.ok && result.reason === "bridge_failed") {
      await requestHelperCode();
    }
  };

  if (!open) return null;

  const body = (
    <Card className={isCard ? "shadow-sm" : "h-full rounded-none border-0 shadow-none"}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-2xl tracking-normal">
              {currentRunId ? "Plan ready" : "Prepare plan"}
            </CardTitle>
            <CardDescription className="mt-1">
              {currentRunId
                ? "Launch the helper when you are ready to continue."
                : "Pick the essentials once. Run Center keeps the plan ready."}
            </CardDescription>
          </div>
          {!isCard && (
            <Button variant="ghost" size="icon" onClick={() => onOpenChange?.(false)} aria-label="Close prepare plan">
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>
        {program && (
          <div className="rounded-lg border bg-[hsl(var(--secondary))] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Activity</p>
            <p className="font-semibold">{program}</p>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading plan...
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Child</Label>
                <Select value={childId} onValueChange={setChildId} disabled={Boolean(currentRunId)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose child" />
                  </SelectTrigger>
                  <SelectContent>
                    {children.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        {childLabel(child)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!childId && <p className="text-xs text-destructive">Choose a child before saving.</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-reminder">Reminder</Label>
                <Select value={reminderMinutes} onValueChange={setReminderMinutes} disabled={Boolean(currentRunId)}>
                  <SelectTrigger id="plan-reminder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 minutes before</SelectItem>
                    <SelectItem value="30">30 minutes before</SelectItem>
                    <SelectItem value="60">1 hour before</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-price-cap">Price cap <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="plan-price-cap"
                  value={priceCap}
                  onChange={(event) => setPriceCap(event.target.value)}
                  inputMode="decimal"
                  placeholder="150"
                  disabled={Boolean(currentRunId)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-provider-link">Provider link</Label>
                <Input
                  id="plan-provider-link"
                  value={providerLink}
                  onChange={(event) => setProviderLink(event.target.value)}
                  placeholder="https://provider.example.com/signup"
                  inputMode="url"
                  disabled={Boolean(currentRunId)}
                />
                {providerLink && !safeProviderUrl && !currentRunId && (
                  <p className="text-xs text-destructive">Use a public HTTPS signup page URL.</p>
                )}
              </div>
            </div>

            <details className="group rounded-lg border p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                <span>Details</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                <div className="rounded-md border bg-background p-3">
                  <p className="font-medium text-foreground">Readiness</p>
                  <p>{readinessSummary.readinessLevel} provider path, {readinessSummary.fixtureCoverage.coverageLabel}.</p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="font-medium text-foreground">Audit</p>
                  <p>Plan creation, launch, pauses, and helper handoff are logged with redaction.</p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="font-medium text-foreground">Provider learning</p>
                  <p>Only redacted pause and field-signature signals are eligible for future review.</p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="font-medium text-foreground">Future automation</p>
                  <p>Set-and-forget remains disabled until provider readiness and mandate checks pass.</p>
                </div>
              </div>
            </details>

            <Alert className="border-primary/20">
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>
                Helper pauses for login, payment, waivers, and final submit.
              </AlertDescription>
            </Alert>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {!subscriptionUsable && !currentRunId && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>{AUTOPILOT_PRICE_LABEL} membership is required before saving a real run.</span>
                  <Button size="sm" variant="outline" onClick={() => startSubscriptionCheckout(returnPath || "/activity-finder")}>
                    Start membership
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {currentRunId ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={launchHelper} disabled={launching} className="sm:flex-1">
                    {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Launch helper
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={savedProviderUrl || providerLink} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open provider
                    </a>
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/run-center")}>
                    View Run Center
                  </Button>
                </div>
                <Button variant="ghost" onClick={requestHelperCode} disabled={helperRequesting}>
                  {helperRequesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  {helperCode ? `Copy helper code ${helperCode}` : "Copy helper code"}
                </Button>
              </div>
            ) : (
              <Button onClick={savePlan} disabled={saving || loading} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                Save plan
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  if (isCard) {
    return <div className="mx-auto w-full max-w-4xl">{body}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="ml-auto h-full w-full max-w-xl overflow-y-auto border-l bg-card shadow-xl">
        {body}
      </div>
    </div>
  );
}
