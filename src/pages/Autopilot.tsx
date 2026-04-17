import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
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
import {
  buildAutopilotIntentPath,
  getSignupIntent,
  updateSignupIntent,
  type SignupIntent,
} from "@/lib/signupIntent";
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

function selectedResultString(intent: SignupIntent | null, key: string) {
  const value = intent?.selectedResult[key];
  return typeof value === "string" ? value : "";
}

function targetProgramFromIntent(intent: SignupIntent) {
  const activity = selectedResultString(intent, "activityLabel") || intent.parsed.activity || "";
  const venue = selectedResultString(intent, "venueName") || intent.parsed.venue || "";
  return [activity, venue].filter(Boolean).join(" at ") || venue || activity || "Guided signup help";
}

function ageFromIntent(intent: SignupIntent) {
  if (intent.parsed.ageYears === null || intent.parsed.ageYears === undefined) return "";
  return String(intent.parsed.ageYears);
}

function SetupTrackerStep({
  number,
  title,
  description,
  state = "upcoming",
}: {
  number: number;
  title: string;
  description: string;
  state?: "done" | "active" | "upcoming";
}) {
  const isDone = state === "done";
  const isActive = state === "active";

  return (
    <div className="flex gap-3">
      <div
        className={[
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
          isDone
            ? "border-[#2f855a] bg-[#eaf7ef] text-[#2f855a]"
            : isActive
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground",
        ].join(" ")}
      >
        {isDone ? <CheckCircle2 className="h-4 w-4" /> : number}
      </div>
      <div className="min-w-0 pb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FinderSummaryItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="line-clamp-2 text-sm font-semibold">{value || "Add this detail"}</p>
    </div>
  );
}

export default function Autopilot() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const intentId = searchParams.get("intent");
  const finderPrefill = Boolean(intentId);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [signupIntent, setSignupIntent] = useState<SignupIntent | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(Boolean(intentId));
  const [intentError, setIntentError] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState(intentId ? "" : KEVA_DAYSMART_LOGIN_URL);
  const [providerKey, setProviderKey] = useState(intentId ? "generic" : "daysmart");
  const [childId, setChildId] = useState("none");
  const [targetProgram, setTargetProgram] = useState(
    intentId ? "Guided signup help" : "Keva Sports Center registration",
  );
  const [registrationOpensAt, setRegistrationOpensAt] = useState("");
  const [participantAge, setParticipantAge] = useState("");
  const [priceCap, setPriceCap] = useState("250");
  const [reminderMinutes, setReminderMinutes] = useState("10");
  const [reminderEmail, setReminderEmail] = useState(true);
  const [reminderSms, setReminderSms] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [preflight, setPreflight] = useState(
    buildPreflightState({
      targetUrlConfirmed: false,
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
  const intentLocation = signupIntent?.parsed.city
    ? [signupIntent.parsed.city, signupIntent.parsed.state].filter(Boolean).join(", ")
    : null;
  const selectedResultAddress =
    typeof signupIntent?.selectedResult.address === "string"
      ? signupIntent.selectedResult.address
      : null;
  const finderActivity =
    selectedResultString(signupIntent, "activityLabel") || signupIntent?.parsed.activity || "";
  const finderVenue =
    selectedResultString(signupIntent, "venueName") ||
    signupIntent?.parsed.venue ||
    signupIntent?.providerName ||
    "";
  const finderLocation = intentLocation || "";
  const finderStatus = signupIntent?.finderStatus || signupIntent?.status || "";
  const autopilotReturnPath = intentId ? buildAutopilotIntentPath(intentId) : "/autopilot";
  const finderMetadata = useMemo(
    () =>
      signupIntent
        ? {
            query: signupIntent.originalQuery || null,
            status: signupIntent.finderStatus || null,
            venue: signupIntent.parsed.venue || signupIntent.providerName || null,
            address: selectedResultAddress,
            location: intentLocation,
          }
        : null,
    [intentLocation, selectedResultAddress, signupIntent],
  );
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
      navigate(`/auth?returnTo=${encodeURIComponent(autopilotReturnPath)}`);
    } else if (user) {
      loadAutopilotData();
    }
  }, [authLoading, autopilotReturnPath, loadAutopilotData, navigate, user]);

  useEffect(() => {
    if (!intentId) {
      setSignupIntent(null);
      setIntentError(null);
      setLoadingIntent(false);
      return;
    }

    if (authLoading || !user) return;

    let isMounted = true;

    async function loadSignupIntent() {
      try {
        setLoadingIntent(true);
        setIntentError(null);
        const intent = await getSignupIntent(intentId);
        if (!isMounted) return;

        const nextUrl = intent.targetUrl || "";
        const nextPlaybook =
          intent.providerKey ||
          (nextUrl ? findPlaybookForUrl(nextUrl).key : "generic");

        setSignupIntent(intent);
        setTargetUrl(nextUrl);
        setProviderKey(nextPlaybook);
        setTargetProgram(targetProgramFromIntent(intent));
        setParticipantAge(ageFromIntent(intent));
        setChildId(intent.selectedChildId || "none");
        setPreflight((current) => ({
          ...current,
          targetUrlConfirmed: Boolean(nextUrl),
        }));
      } catch (error) {
        if (!isMounted) return;
        setIntentError(
          error instanceof Error
            ? error.message
            : "This signup intent could not be loaded.",
        );
      } finally {
        if (isMounted) setLoadingIntent(false);
      }
    }

    void loadSignupIntent();

    return () => {
      isMounted = false;
    };
  }, [authLoading, intentId, user]);

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
    showSuccessToast("Helper setup copied", "Paste it into the Chrome helper before registration opens.");
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

      const { data: createdRun, error } = await supabase
        .from("autopilot_runs")
        .insert(runInsert)
        .select("id")
        .single();
      if (error) throw error;

      if (signupIntent && createdRun?.id) {
        try {
          const updatedIntent = await updateSignupIntent(signupIntent.id, {
            status: "scheduled",
            autopilot_run_id: createdRun.id,
            selected_child_id: childId === "none" ? null : childId,
          });
          setSignupIntent(updatedIntent);
        } catch (intentUpdateError) {
          console.warn(
            "[Autopilot] Signup intent was not linked to run",
            intentUpdateError instanceof Error ? intentUpdateError.message : intentUpdateError,
          );
        }
      }

      setCreatedPacket(packet);
      showSuccessToast("Signup helper setup saved", "Copy it into the Chrome helper before registration opens.");
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

  if (authLoading || loadingData || loadingIntent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Loading supervised autopilot...</p>
        </div>
      </div>
    );
  }

  if (intentError) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto max-w-3xl px-4 py-10">
          <Button
            type="button"
            variant="ghost"
            className="mb-4 -ml-3 text-muted-foreground"
            onClick={() => navigate("/activity-finder")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Activity Finder
          </Button>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Signup setup unavailable</AlertTitle>
            <AlertDescription>
              {intentError === "signup_intent_not_found"
                ? "This signup setup was not found or does not belong to your account."
                : intentError}
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  if (finderPrefill) {
    const finderTitle =
      [finderActivity, finderVenue].filter(Boolean).join(" at ") ||
      targetProgram ||
      "your signup";
    const statusLabel =
      finderStatus === "tested_fast_path" ? "Tested Fast Path" : "Guided Autopilot";
    const statusClass =
      finderStatus === "tested_fast_path"
        ? "border-[#b9e5c7] bg-[#eaf7ef] text-[#2f855a]"
        : "border-[#b8d7e6] bg-[#e8f2f7] text-[#1f5a7a]";
    const childOrAge =
      selectedChild
        ? `${selectedChild.first_name} ${selectedChild.last_name}`
        : participantAge
          ? `Age ${participantAge}`
          : null;
    const detailsReady = Boolean(targetUrl.trim() && targetProgram.trim());

    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <Button
            type="button"
            variant="ghost"
            className="mb-4 -ml-3 text-muted-foreground"
            onClick={() => navigate("/activity-finder")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Activity Finder
          </Button>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <section className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
                    {statusLabel}
                  </span>
                  <Badge variant="secondary">Step 2 of 4</Badge>
                </div>
                <h1 className="max-w-3xl text-3xl font-bold tracking-normal text-primary sm:text-4xl">
                  Set up signup help for {finderTitle}.
                </h1>
                <p className="mt-3 max-w-3xl text-muted-foreground">
                  We found the signup path. Now confirm the basics, choose your reminder, and save a
                  Chrome Helper setup so registration day feels boring in the best possible way.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FinderSummaryItem
                    icon={<Search className="h-3.5 w-3.5" />}
                    label="Signup"
                    value={finderVenue || targetProgram}
                  />
                  <FinderSummaryItem
                    icon={<Target className="h-3.5 w-3.5" />}
                    label="Activity"
                    value={finderActivity || targetProgram}
                  />
                  <FinderSummaryItem
                    icon={<UserRound className="h-3.5 w-3.5" />}
                    label="Child"
                    value={childOrAge}
                  />
                  <FinderSummaryItem
                    icon={<Clock3 className="h-3.5 w-3.5" />}
                    label="Reminder"
                    value={`${reminderMinutesValue} minutes before`}
                  />
                </div>
              </section>

              <Card>
                <CardHeader>
                  <CardTitle>Confirm the essentials</CardTitle>
                  <CardDescription>
                    Keep this to the few things SignupAssist needs before registration opens.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {!subscriptionUsable && (
                    <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                      <ShieldCheck className="h-4 w-4" />
                      <AlertTitle>Membership needed before saving</AlertTitle>
                      <AlertDescription>
                        Real signup helper setups require an active {AUTOPILOT_PRICE_LABEL} membership.
                        You can cancel monthly renewal any time, and your family profiles stay intact.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="finder-target-url">Signup page</Label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="finder-target-url"
                          value={targetUrl}
                          onChange={(event) => setTargetUrl(event.target.value)}
                          placeholder="Paste the exact registration page"
                        />
                        <Button type="button" variant="outline" onClick={detectProvider}>
                          Check page
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For Keva, this is the DaySmart login/signup page. Login remains your step.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Child</Label>
                      <Select value={childId} onValueChange={setChildId}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Choose during signup</SelectItem>
                          {children.map((child) => (
                            <SelectItem key={child.id} value={child.id}>
                              {child.first_name} {child.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="finder-age">Age</Label>
                      <Input
                        id="finder-age"
                        inputMode="numeric"
                        value={participantAge}
                        onChange={(event) => setParticipantAge(event.target.value)}
                        placeholder="9"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="finder-program">Activity or session</Label>
                      <Input
                        id="finder-program"
                        value={targetProgram}
                        onChange={(event) => setTargetProgram(event.target.value)}
                        placeholder="Summer soccer camp, U9 soccer, 9am swim..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="finder-opens-at">Registration opens</Label>
                      <Input
                        id="finder-opens-at"
                        type="datetime-local"
                        value={registrationOpensAt}
                        onChange={(event) => setRegistrationOpensAt(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="finder-price-cap">Price cap</Label>
                      <Input
                        id="finder-price-cap"
                        inputMode="decimal"
                        value={priceCap}
                        onChange={(event) => setPriceCap(event.target.value)}
                        placeholder="250"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border bg-[hsl(var(--secondary))] p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-end">
                      <div className="space-y-2 md:w-44">
                        <Label htmlFor="finder-reminder-minutes">Reminder</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="finder-reminder-minutes"
                            inputMode="numeric"
                            value={reminderMinutes}
                            onChange={(event) => setReminderMinutes(event.target.value)}
                          />
                          <span className="whitespace-nowrap text-sm text-muted-foreground">min before</span>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-wrap gap-3">
                        <label className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                          <Checkbox
                            checked={reminderEmail}
                            onCheckedChange={(checked) => setReminderEmail(checked === true)}
                          />
                          Email
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                          <Checkbox
                            checked={reminderSms}
                            onCheckedChange={(checked) => setReminderSms(checked === true)}
                          />
                          Text message
                        </label>
                      </div>
                    </div>
                    {reminderSms && (
                      <Input
                        className="mt-3"
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        placeholder="Phone number for text reminder"
                      />
                    )}
                  </div>

                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">Ready to reuse</p>
                        <p className="text-sm text-muted-foreground">
                          Check off what is already prepared. Anything sensitive still pauses for you.
                        </p>
                      </div>
                      <Badge variant={readinessScore >= 80 ? "default" : "secondary"}>
                        {readinessScore}% ready
                      </Badge>
                    </div>
                    <Progress value={readinessScore} className="mb-4" />
                    <div className="grid gap-3 md:grid-cols-2">
                      {PREFLIGHT_CHECKS.map((check) => (
                        <label
                          key={check.key}
                          className="flex items-start gap-3 rounded-lg border bg-background p-3"
                        >
                          <Checkbox
                            checked={preflight[check.key]}
                            onCheckedChange={(checked) => togglePreflight(check.key, checked === true)}
                          />
                          <span>
                            <span className="block text-sm font-medium">{check.label}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{check.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {providerMismatch && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        The page looks like {detectedPlaybook?.name}, but the selected provider is {selectedPlaybook.name}.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      onClick={createRun}
                      disabled={creatingRun || !subscriptionUsable || !detailsReady}
                    >
                      {creatingRun ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving setup...
                        </>
                      ) : (
                        <>
                          <ClipboardCheck className="h-4 w-4" />
                          Save signup setup
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
                      Copy to Chrome Helper
                    </Button>
                    {targetUrl.trim() && (
                      <Button type="button" variant="ghost" asChild>
                        <a href={targetUrl.trim()} target="_blank" rel="noreferrer">
                          Open signup page
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {createdPacket && (
                <Alert className="border-[#b9e5c7] bg-[#eaf7ef]">
                  <CheckCircle2 className="h-4 w-4 text-[#2f855a]" />
                  <AlertTitle>Setup saved</AlertTitle>
                  <AlertDescription>
                    Copy it to the Chrome Helper before registration opens. We’ll still pause for login,
                    payment, waivers, medical details, and final submit.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Where you are</CardTitle>
                  <CardDescription>Four simple steps from search to signup day.</CardDescription>
                </CardHeader>
                <CardContent>
                  <SetupTrackerStep
                    number={1}
                    title="Found the signup"
                    description={finderVenue || finderActivity || "We carried over your search result."}
                    state="done"
                  />
                  <SetupTrackerStep
                    number={2}
                    title="Confirm details"
                    description="Signup page, child, reminder, and price cap."
                    state={createdPacket ? "done" : "active"}
                  />
                  <SetupTrackerStep
                    number={3}
                    title="Save reusable info"
                    description="Family details are ready for the helper to reuse."
                    state={createdPacket ? "done" : "upcoming"}
                  />
                  <SetupTrackerStep
                    number={4}
                    title="Use the helper"
                    description="Open the reminder, let SignupAssist fill, and approve sensitive steps."
                    state="upcoming"
                  />
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    What SignupAssist will do
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Fill low-risk family and child fields quickly.</p>
                  <p>Remind you {reminderMinutesValue} minutes before registration opens.</p>
                  <p>Pause for login, payment, waivers, medical questions, and final submit.</p>
                </CardContent>
              </Card>

              <BillingCard
                compact
                userId={user?.id}
                returnPath={autopilotReturnPath}
                onSubscriptionChange={setSubscription}
              />
            </aside>
          </div>
        </main>
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
