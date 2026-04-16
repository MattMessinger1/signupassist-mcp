import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Clock3,
  CreditCard,
  Loader2,
  PauseCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  KEVA_DAYSMART_LOGIN_URL,
  PROVIDER_PLAYBOOKS,
  findPlaybookByKey,
  findPlaybookForUrl,
} from "@/lib/autopilot/playbooks";
import { buildAutopilotAuditEvent, detectProviderMismatch } from "@/lib/autopilot/classifier";
import {
  PREFLIGHT_CHECKS,
  SUPERVISED_AUTOPILOT_BILLING_COPY,
  buildAutopilotRunPacket,
  buildPreflightState,
  calculateReadinessScore,
  type AutopilotRunPacket,
  type PreflightCheckKey,
} from "@/lib/autopilot/runPacket";
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

const ageYearsFromInput = (value: string) => {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 19) return null;
  return numericValue;
};

export default function Autopilot() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const finderPrefill = searchParams.get("finder") === "1";
  const finderActivity = searchParams.get("activity") || "";
  const finderVenue = searchParams.get("venue") || "";
  const finderAddress = searchParams.get("address") || "";
  const finderLocation = searchParams.get("location") || "";
  const finderStatus = searchParams.get("finderStatus") || "";
  const finderQuery = searchParams.get("finderQuery") || "";
  const finderAge = searchParams.get("age") || "";
  const initialProviderKey = searchParams.get("providerKey") || "daysmart";
  const initialTargetUrl = finderPrefill ? searchParams.get("targetUrl") || "" : KEVA_DAYSMART_LOGIN_URL;
  const initialTargetProgram =
    [finderActivity, finderVenue].filter(Boolean).join(" at ") ||
    (finderPrefill ? finderVenue || "Guided signup help" : "Keva Sports Center registration");
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [targetUrl, setTargetUrl] = useState(initialTargetUrl);
  const [providerKey, setProviderKey] = useState(initialProviderKey);
  const [childId, setChildId] = useState("none");
  const [targetProgram, setTargetProgram] = useState(initialTargetProgram);
  const [registrationOpensAt, setRegistrationOpensAt] = useState("");
  const [participantAge, setParticipantAge] = useState(finderAge);
  const [priceCap, setPriceCap] = useState("250");
  const [reminderMinutes, setReminderMinutes] = useState("10");
  const [reminderEmail, setReminderEmail] = useState(true);
  const [reminderSms, setReminderSms] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [preflight, setPreflight] = useState(
    buildPreflightState({
      targetUrlConfirmed: finderPrefill && Boolean(initialTargetUrl) && initialProviderKey !== "generic",
    }),
  );
  const [createdPacket, setCreatedPacket] = useState<AutopilotRunPacket | null>(null);
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
  const selectedChild = children.find((child) => child.id === childId);
  const readinessScore = calculateReadinessScore(preflight);
  const reminderChannels = useMemo(
    () => [
      ...(reminderEmail ? ["email"] : []),
      ...(reminderSms ? ["sms"] : []),
    ],
    [reminderEmail, reminderSms],
  );
  const reminderMinutesValue = Number.isFinite(Number(reminderMinutes))
    ? Math.max(1, Math.round(Number(reminderMinutes)))
    : 10;
  const participantAgeYears = ageYearsFromInput(participantAge);
  const finderMetadata = finderPrefill
    ? {
        query: finderQuery || null,
        status: finderStatus || null,
        venue: finderVenue || null,
        address: finderAddress || null,
        location: finderLocation || null,
      }
    : null;
  const runPacketPreview = useMemo(
    () =>
      buildAutopilotRunPacket({
        playbook: selectedPlaybook,
        targetUrl: targetUrl.trim(),
        targetProgram: targetProgram.trim() || null,
        registrationOpensAt: registrationOpensAt || null,
        maxTotalCents: centsFromDollarInput(priceCap),
        participantAgeYears,
        finder: finderMetadata,
        reminder: {
          minutesBefore: reminderMinutesValue,
          channels: reminderChannels.length ? reminderChannels : ["email"],
          phoneNumber: reminderSms ? phoneNumber.trim() || null : null,
        },
        child: selectedChild
          ? {
              id: selectedChild.id,
              name: `${selectedChild.first_name} ${selectedChild.last_name}`,
            }
          : null,
        preflight,
      }),
    [
      finderMetadata,
      participantAgeYears,
      phoneNumber,
      preflight,
      priceCap,
      registrationOpensAt,
      reminderChannels,
      reminderMinutesValue,
      reminderSms,
      selectedChild,
      selectedPlaybook,
      targetProgram,
      targetUrl,
    ],
  );

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

  const useKevaDaySmartStarter = () => {
    setTargetUrl(KEVA_DAYSMART_LOGIN_URL);
    setProviderKey("daysmart");
    setTargetProgram("Keva Sports Center registration");
    setPreflight((current) => ({
      ...current,
      targetUrlConfirmed: true,
    }));
  };

  const togglePreflight = (key: PreflightCheckKey, checked: boolean) => {
    setPreflight((current) => ({
      ...current,
      [key]: checked,
    }));
  };

  const copyRunPacket = async (packet: AutopilotRunPacket) => {
    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    showSuccessToast("Run packet copied", "Paste it into the Chrome helper before registration opens.");
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
      const packet = buildAutopilotRunPacket({
        playbook,
        targetUrl: targetUrl.trim(),
        targetProgram: targetProgram.trim() || null,
        registrationOpensAt: registrationOpensAt || null,
        maxTotalCents,
        participantAgeYears,
        finder: finderMetadata,
        reminder: {
          minutesBefore: reminderMinutesValue,
          channels: reminderChannels.length ? reminderChannels : ["email"],
          phoneNumber: reminderSms ? phoneNumber.trim() || null : null,
        },
        child: selectedChild
          ? {
              id: selectedChild.id,
              name: `${selectedChild.first_name} ${selectedChild.last_name}`,
            }
          : null,
        preflight,
      });
      const runInsert = {
        user_id: user.id,
        provider_key: playbook.key,
        provider_name: playbook.name,
        target_url: targetUrl.trim(),
        target_program: targetProgram.trim() || null,
        child_id: childId === "none" ? null : childId,
        status: "ready",
        confidence: playbook.confidence,
        caps: {
          max_total_cents: maxTotalCents,
          registration_opens_at: registrationOpensAt || null,
          readiness_score: packet.readiness.score,
          preflight: packet.readiness.checks,
          payment: packet.payment,
          reminder: packet.reminder,
          finder: packet.finder,
          participant_age_years: participantAgeYears,
          run_packet_version: packet.version,
        } as Json,
        allowed_actions: packet.safety.allowedActions as unknown as Json,
        stop_conditions: packet.safety.stopConditions as unknown as Json,
        audit_events: [
          buildAutopilotAuditEvent("run_created", {
            provider_key: playbook.key,
            target_url: targetUrl.trim(),
            target_program: targetProgram.trim() || null,
            max_total_cents: maxTotalCents,
            registration_opens_at: registrationOpensAt || null,
            readiness_score: packet.readiness.score,
            reminder: packet.reminder,
            finder: packet.finder,
            participant_age_years: participantAgeYears,
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

      const { error } = await supabase.from("autopilot_runs").insert(runInsert);
      if (error) throw error;

      setCreatedPacket(packet);
      showSuccessToast("Run packet ready", "Copy it into the Chrome helper before registration opens.");
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
              V1 supervised autopilot
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

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Zap className="h-4 w-4 text-primary" />
              Faster under pressure
            </div>
            <p className="text-sm text-muted-foreground">
              Known family and child fields are prepared before the registration window opens.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <CreditCard className="h-4 w-4 text-primary" />
              Provider-direct payment
            </div>
            <p className="text-sm text-muted-foreground">
              SignupAssist pauses at provider checkout. The parent approves and pays there.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Set and Forget foundation
            </div>
            <p className="text-sm text-muted-foreground">
              Run packets capture playbook, readiness, price caps, and pause reasons for future automation.
            </p>
          </div>
        </div>

        {finderPrefill && (
          <Alert className="mb-6 border-primary/20 bg-[hsl(var(--secondary))]">
            <Search className="h-4 w-4" />
            <AlertTitle>
              {finderStatus === "tested_fast_path" ? "Tested Fast Path found" : "Guided Autopilot ready"}
            </AlertTitle>
            <AlertDescription>
              We carried over {finderActivity || "your activity"} {finderVenue ? `at ${finderVenue}` : ""}
              {finderLocation ? ` near ${finderLocation}` : ""}. Confirm the signup link, reminder, and reusable info before registration opens.
            </AlertDescription>
          </Alert>
        )}

        <Alert className="mb-6 border-primary/20 bg-[hsl(var(--secondary))]">
          <Target className="h-4 w-4" />
          <AlertTitle>First provider focus: DaySmart / Dash for Keva</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              This MVP slice is grounded in Keva's DaySmart flow. Login remains a parent step; SignupAssist fills safe registration fields after you are in.
            </span>
            <Button type="button" variant="outline" onClick={useKevaDaySmartStarter}>
              Use Keva DaySmart starter
            </Button>
          </AlertDescription>
        </Alert>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Signup help setup
                </CardTitle>
                <CardDescription>
                  Confirm the child, signup page, reminder, reusable info, and safety limits before the rush.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!subscriptionUsable && (
                  <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Membership gate</AlertTitle>
                    <AlertDescription>
                      Real supervised autopilot runs require an active {AUTOPILOT_PRICE_LABEL} membership. Subscribe in the billing card, then create and copy the helper packet.
                    </AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <CreditCard className="h-4 w-4" />
                  <AlertTitle>Provider fees stay with the provider</AlertTitle>
                  <AlertDescription>
                    {SUPERVISED_AUTOPILOT_BILLING_COPY.noSuccessFee}{" "}
                    {SUPERVISED_AUTOPILOT_BILLING_COPY.providerFee} The helper pauses at checkout,
                    payment confirmation, and final submit.
                  </AlertDescription>
                </Alert>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="target-url">Signup page URL</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="target-url"
                        value={targetUrl}
                        onChange={(event) => setTargetUrl(event.target.value)}
                        placeholder="Paste the exact registration page, not just the venue homepage"
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
                    <Label htmlFor="participant-age">Age or grade</Label>
                    <Input
                      id="participant-age"
                      inputMode="numeric"
                      value={participantAge}
                      onChange={(event) => setParticipantAge(event.target.value)}
                      placeholder="9"
                    />
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
                    <Label htmlFor="registration-opens-at">Registration opens</Label>
                    <Input
                      id="registration-opens-at"
                      type="datetime-local"
                      value={registrationOpensAt}
                      onChange={(event) => setRegistrationOpensAt(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price-cap">Price cap in dollars</Label>
                    <Input
                      id="price-cap"
                      inputMode="decimal"
                      value={priceCap}
                      onChange={(event) => setPriceCap(event.target.value)}
                      placeholder="250"
                    />
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="mb-3">
                    <p className="font-medium">Reminder</p>
                    <p className="text-sm text-muted-foreground">
                      We’ll remind you before signup opens so registration day does not sneak up on you.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="reminder-minutes">Minutes before</Label>
                      <Input
                        id="reminder-minutes"
                        inputMode="numeric"
                        value={reminderMinutes}
                        onChange={(event) => setReminderMinutes(event.target.value)}
                      />
                    </div>
                    <div className="space-y-3">
                      <Label>Reminder channels</Label>
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                          <Checkbox
                            checked={reminderEmail}
                            onCheckedChange={(checked) => setReminderEmail(checked === true)}
                          />
                          Email
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                          <Checkbox
                            checked={reminderSms}
                            onCheckedChange={(checked) => setReminderSms(checked === true)}
                          />
                          Text message
                        </label>
                      </div>
                      {reminderSms && (
                        <Input
                          value={phoneNumber}
                          onChange={(event) => setPhoneNumber(event.target.value)}
                          placeholder="Phone number for text reminder"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Readiness preflight</p>
                      <p className="text-sm text-muted-foreground">
                        These checks make V1 faster now and make future Set and Forget safer later.
                      </p>
                    </div>
                    <Badge variant={readinessScore >= 80 ? "default" : "secondary"}>
                      {readinessScore}% ready
                    </Badge>
                  </div>
                  <Progress value={readinessScore} className="mb-4" />
                  <div className="grid gap-3 md:grid-cols-2">
                    {PREFLIGHT_CHECKS.map((check) => (
                      <div
                        key={check.key}
                        className="flex items-start gap-3 rounded-lg border bg-background p-3"
                      >
                        <Checkbox
                          id={`preflight-${check.key}`}
                          checked={preflight[check.key]}
                          onCheckedChange={(checked) => togglePreflight(check.key, checked === true)}
                        />
                        <div>
                          <Label htmlFor={`preflight-${check.key}`} className="text-sm font-medium">
                            {check.label}
                          </Label>
                          <p className="mt-1 text-xs text-muted-foreground">{check.description}</p>
                        </div>
                      </div>
                    ))}
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
                        Creating packet...
                      </>
                    ) : (
                      <>
                        <ClipboardCheck className="h-4 w-4" />
                        Create run packet
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyRunPacket(createdPacket || runPacketPreview)}
                    disabled={!targetUrl.trim() || !subscriptionUsable}
                  >
                    <Clipboard className="h-4 w-4" />
                    Copy packet for helper
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/credentials")}>
                    <UserRound className="h-4 w-4" />
                    Family profiles
                  </Button>
                </div>
              </CardContent>
            </Card>

            {createdPacket && (
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5" />
                    Run packet ready
                  </CardTitle>
                  <CardDescription>
                    Copy this packet into the Chrome helper, then open the provider page when registration opens.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Provider</p>
                      <p className="text-sm font-medium">{createdPacket.target.providerName}</p>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Target</p>
                      <p className="line-clamp-1 text-sm font-medium">
                        {createdPacket.target.program || createdPacket.target.url}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Readiness</p>
                      <p className="text-sm font-medium">{createdPacket.readiness.score}%</p>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <p className="text-xs text-muted-foreground">Billing</p>
                      <p className="text-sm font-medium">No supervised-autopilot success fee</p>
                    </div>
                  </div>
                  <Button type="button" onClick={() => copyRunPacket(createdPacket)}>
                    <Clipboard className="h-4 w-4" />
                    Copy packet
                  </Button>
                </CardContent>
              </Card>
            )}

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
