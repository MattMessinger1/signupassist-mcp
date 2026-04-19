import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clipboard,
  ClipboardCheck,
  Clock3,
  Loader2,
  PauseCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
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
import {
  SET_AND_FORGET_LADDER,
  buildRedactedProviderObservation,
  getProviderReadinessSummary,
  type ProviderReadinessLevel,
} from "@/lib/providerLearning";
import { showErrorToast, showSuccessToast } from "@/lib/toastHelpers";

type ChildRow = Pick<
  Database["public"]["Tables"]["children"]["Row"],
  "id" | "first_name" | "last_name" | "dob"
>;

type AutopilotRun = Database["public"]["Tables"]["autopilot_runs"]["Row"];

type WizardStepId =
  | "activity"
  | "provider"
  | "child"
  | "timing"
  | "safety"
  | "learning"
  | "review";

const WIZARD_STEPS: Array<{
  id: WizardStepId;
  title: string;
  description: string;
}> = [
  {
    id: "activity",
    title: "Activity",
    description: "Confirm the carried-over program or session.",
  },
  {
    id: "provider",
    title: "Provider",
    description: "Confirm the signup URL and provider playbook.",
  },
  {
    id: "child",
    title: "Child/Profile",
    description: "Choose an existing profile or decide during the run.",
  },
  {
    id: "timing",
    title: "Timing and reminder",
    description: "Set the registration window and reminder.",
  },
  {
    id: "safety",
    title: "Safety limits",
    description: "Set price caps, allowed actions, and pause rules.",
  },
  {
    id: "learning",
    title: "Provider learning",
    description: "Choose redacted learning signals for future readiness.",
  },
  {
    id: "review",
    title: "Review and create",
    description: "Create the supervised run packet.",
  },
];

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

function childLabel(child?: ChildRow | null) {
  if (!child) return "Choose during run";
  return `${child.first_name} ${child.last_name}`.trim();
}

function providerReadinessClass(readiness: ProviderReadinessLevel) {
  if (readiness === "navigation_verified") return "border-[#b9e5c7] bg-[#eaf7ef] text-[#2f855a]";
  if (readiness === "fill_safe" || readiness === "recognized") return "border-[#b8d7e6] bg-[#e8f2f7] text-[#1f5a7a]";
  return "border-[#f3d8b6] bg-[#fff3e2] text-[#d9822b]";
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function WizardRail({
  activeStep,
  completed,
  onStepChange,
}: {
  activeStep: number;
  completed: boolean;
  onStepChange: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Setup steps</CardTitle>
        <CardDescription>Move through the pieces parents naturally check.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {WIZARD_STEPS.map((step, index) => {
          const isActive = activeStep === index;
          const isDone = completed || index < activeStep;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepChange(index)}
              className={[
                "flex w-full gap-3 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-primary bg-[hsl(var(--secondary))]"
                  : "bg-background hover:border-primary/40",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  isDone
                    ? "border-[#2f855a] bg-[#eaf7ef] text-[#2f855a]"
                    : isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground",
                ].join(" ")}
              >
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{step.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{step.description}</span>
              </span>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
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
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="line-clamp-2 text-sm font-semibold">{value || "Add this detail"}</p>
    </div>
  );
}

function SafetyList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="font-medium">{title}</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Autopilot() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const intentId = searchParams.get("intent");
  const [activeStep, setActiveStep] = useState(0);
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
  const [phoneNumber] = useState("");
  const [learningOptIn, setLearningOptIn] = useState(false);
  const [newChildFirstName, setNewChildFirstName] = useState("");
  const [newChildLastName, setNewChildLastName] = useState("");
  const [newChildDob, setNewChildDob] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);
  const [preflight, setPreflight] = useState(
    buildPreflightState({
      targetUrlConfirmed: false,
    }),
  );
  const [createdPacket, setCreatedPacket] = useState<AutopilotRunPacket | null>(null);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
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
  const selectedChild = children.find((child) => child.id === childId);
  const readinessScore = calculateReadinessScore(preflight);
  const reminderChannels = useMemo(
    () => (reminderEmail ? ["email"] : []),
    [reminderEmail],
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
  const finderStatus = signupIntent?.finderStatus || signupIntent?.status || "";
  const autopilotReturnPath = intentId ? buildAutopilotIntentPath(intentId) : "/autopilot";
  const providerLearningSummary = useMemo(
    () => getProviderReadinessSummary(selectedPlaybook.key),
    [selectedPlaybook.key],
  );
  const readiness = providerLearningSummary.readinessLevel;
  const safeTargetUrl = safeExternalUrl(targetUrl.trim());
  const detailsReady = Boolean(safeTargetUrl && targetProgram.trim());
  const maxTotalCents = centsFromDollarInput(priceCap);
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
        targetUrl: safeTargetUrl || targetUrl.trim(),
        targetProgram: targetProgram.trim() || null,
        registrationOpensAt: registrationOpensAt || null,
        maxTotalCents,
        participantAgeYears,
        finder: finderMetadata,
        reminder: {
          minutesBefore: reminderMinutesValue,
          channels: reminderChannels.length ? reminderChannels : ["email"],
          phoneNumber: null,
        },
        child: selectedChild
          ? {
              id: selectedChild.id,
              name: childLabel(selectedChild),
            }
          : null,
        preflight,
      }),
    [
      finderMetadata,
      maxTotalCents,
      participantAgeYears,
      preflight,
      registrationOpensAt,
      reminderChannels,
      reminderMinutesValue,
      selectedChild,
      selectedPlaybook,
      targetProgram,
      targetUrl,
      safeTargetUrl,
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
          childProfileReady: Boolean(intent.selectedChildId),
          targetUrlConfirmed: Boolean(safeExternalUrl(nextUrl)),
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

  const updateTargetUrl = (value: string) => {
    setTargetUrl(value);
    setPreflight((current) => ({
      ...current,
      targetUrlConfirmed: false,
    }));
  };

  const updateSelectedChild = (value: string) => {
    setChildId(value);
    setPreflight((current) => ({
      ...current,
      childProfileReady: value !== "none",
    }));
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

  const createChildProfile = async () => {
    if (!user) return;
    const firstName = newChildFirstName.trim();
    if (!firstName) {
      showErrorToast("First name required", "Add a first name or choose during run.");
      return;
    }

    try {
      setCreatingChild(true);
      const { data, error } = await supabase
        .from("children")
        .insert({
          user_id: user.id,
          first_name: firstName,
          last_name: newChildLastName.trim(),
          dob: newChildDob || null,
        })
        .select("id, first_name, last_name, dob")
        .single();

      if (error) throw error;
      setChildren((current) => [data, ...current]);
      setChildId(data.id);
      setNewChildFirstName("");
      setNewChildLastName("");
      setNewChildDob("");
      setPreflight((current) => ({
        ...current,
        childProfileReady: true,
      }));
      showSuccessToast("Child profile added", "This profile is selected for the supervised run packet.");
    } catch (error) {
      showErrorToast(
        "Could not add child profile",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setCreatingChild(false);
    }
  };

  const copyRunPacket = async (packet: AutopilotRunPacket) => {
    await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
    showSuccessToast("Helper setup copied", "Paste it into the Chrome helper before registration opens.");
  };

  const createRun = async () => {
    if (!user) return;

    if (createdPacket || createdRunId) {
      setActiveStep(WIZARD_STEPS.length - 1);
      showSuccessToast("Run already created", "Open the dashboard to review or resume it.");
      return;
    }

    if (!subscriptionUsable) {
      showErrorToast(
        "Membership required",
        `Start ${AUTOPILOT_PRICE_LABEL} before creating a real supervised autopilot run.`,
      );
      return;
    }

    if (!safeTargetUrl) {
      showErrorToast("Valid provider URL required", "Add an http or https signup page URL before starting.");
      setActiveStep(1);
      return;
    }

    if (providerMismatch) {
      showErrorToast(
        "Provider mismatch",
        "The selected provider does not match the signup URL. Detect the provider or choose generic beta.",
      );
      setActiveStep(1);
      return;
    }

    try {
      setCreatingRun(true);

      const playbook = findPlaybookByKey(providerKey);
      const packet = buildAutopilotRunPacket({
        playbook,
        targetUrl: safeTargetUrl,
        targetProgram: targetProgram.trim() || null,
        registrationOpensAt: registrationOpensAt || null,
        maxTotalCents,
        participantAgeYears,
        finder: finderMetadata,
        reminder: {
          minutesBefore: reminderMinutesValue,
          channels: reminderChannels.length ? reminderChannels : ["email"],
          phoneNumber: null,
        },
        child: selectedChild
          ? {
              id: selectedChild.id,
              name: childLabel(selectedChild),
            }
          : null,
        preflight,
      });
      const providerLearning = {
        provider_readiness: providerLearningSummary.readinessLevel,
        confidence: providerLearningSummary.confidenceScore,
        active_playbook_version: providerLearningSummary.activePlaybookVersion,
        fixture_coverage: providerLearningSummary.fixtureCoverage,
        supported_actions: providerLearningSummary.supportedActions,
        stop_conditions: providerLearningSummary.stopConditions,
        promotion: providerLearningSummary.promotionPolicy,
        automation_policy: providerLearningSummary.automationPolicy,
        opt_in_redacted_learning: learningOptIn,
        no_child_pii_in_learning: true,
        signup_intent_id: signupIntent?.id || null,
        ladder: SET_AND_FORGET_LADDER,
      };
      const runInsert = {
        user_id: user.id,
        provider_key: playbook.key,
        provider_name: playbook.name,
        target_url: safeTargetUrl,
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
          provider_learning: providerLearning,
          participant_age_years: participantAgeYears,
          run_packet_version: packet.version,
        } as unknown as Json,
        allowed_actions: packet.safety.allowedActions as unknown as Json,
        stop_conditions: packet.safety.stopConditions as unknown as Json,
        audit_events: [
          buildAutopilotAuditEvent("run_created", {
            provider_key: playbook.key,
            target_url: safeTargetUrl,
            target_program: targetProgram.trim() || null,
            max_total_cents: maxTotalCents,
            registration_opens_at: registrationOpensAt || null,
            readiness_score: packet.readiness.score,
            reminder: packet.reminder,
            finder: packet.finder,
            provider_learning: providerLearning,
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
      const redactedObservation = buildRedactedProviderObservation(runInsert);
      runInsert.caps = {
        ...(runInsert.caps as unknown as Record<string, unknown>),
        provider_learning: {
          ...providerLearning,
          redacted_observation_available: true,
          redacted_observation: learningOptIn ? redactedObservation : null,
        },
      } as unknown as Json;

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

      setCreatedRunId(createdRun?.id || null);
      setCreatedPacket(packet);
      setActiveStep(6);
      showSuccessToast("Supervised run packet created", "SignupAssist will still pause for sensitive actions.");
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

  const renderStep = () => {
    const step = WIZARD_STEPS[activeStep]?.id || "activity";

    switch (step) {
      case "activity":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Activity
              </CardTitle>
              <CardDescription>
                Confirm the activity or session before SignupAssist creates the supervised packet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {signupIntent?.originalQuery && (
                <Alert className="border-primary/20 bg-[hsl(var(--secondary))]">
                  <Search className="h-4 w-4" />
                  <AlertTitle>Carried from Activity Finder</AlertTitle>
                  <AlertDescription>{signupIntent.originalQuery}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="target-program">Activity or session display</Label>
                  <Input
                    id="target-program"
                    value={targetProgram}
                    onChange={(event) => setTargetProgram(event.target.value)}
                    placeholder="Summer soccer camp, U9 soccer, 9am swim..."
                  />
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
                  <p className="text-xs text-muted-foreground">
                    Used only for matching and the supervised run packet.
                  </p>
                </div>
                <SummaryTile
                  icon={<Search className="h-3.5 w-3.5" />}
                  label="Finder status"
                  value={finderStatus || "Manual setup"}
                />
              </div>
            </CardContent>
          </Card>
        );
      case "provider":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Provider
              </CardTitle>
              <CardDescription>
                Confirm the signup URL and selected provider playbook. Provider uncertainty pauses the run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="target-url">Signup URL</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="target-url"
                      value={targetUrl}
                      onChange={(event) => updateTargetUrl(event.target.value)}
                      placeholder="Paste the exact registration page"
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
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Provider readiness level</p>
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${providerReadinessClass(readiness)}`}>
                    {readiness}
                  </span>
                </div>
                <SummaryTile
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label="Provider key"
                  value={selectedPlaybook.key}
                />
              </div>

              <label className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm">
                <Checkbox
                  checked={preflight.targetUrlConfirmed}
                  onCheckedChange={(checked) => togglePreflight("targetUrlConfirmed", checked === true)}
                />
                <span>
                  <span className="block font-medium">I confirmed this is the intended signup URL</span>
                  <span className="mt-1 block text-muted-foreground">
                    Editing the URL clears this check so the run packet records parent review.
                  </span>
                </span>
              </label>

              {safeTargetUrl && (
                <Button type="button" variant="outline" asChild>
                  <a href={safeTargetUrl} target="_blank" rel="noreferrer">
                    Open signup page
                  </a>
                </Button>
              )}

              {targetUrl.trim() && !safeTargetUrl && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Use a valid http or https signup URL before opening or saving the supervised packet.
                  </AlertDescription>
                </Alert>
              )}

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

              {selectedPlaybook.key === "generic" && (
                <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Generic provider safety mode</AlertTitle>
                  <AlertDescription>
                    Generic mode is conservative. SignupAssist fills only high-confidence fields and pauses for provider uncertainty.
                  </AlertDescription>
                </Alert>
              )}

              {!intentId && (
                <Button type="button" variant="outline" onClick={useKevaDaySmartStarter}>
                  Use Keva DaySmart starter
                </Button>
              )}
            </CardContent>
          </Card>
        );
      case "child":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" />
                Child/Profile
              </CardTitle>
              <CardDescription>
                Choose a profile for reusable safe fields, or choose during run. Medical and allergy fields are not collected here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Child profile</Label>
                <Select value={childId} onValueChange={updateSelectedChild}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose during run</SelectItem>
                    {children.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        {childLabel(child)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border bg-[hsl(var(--secondary))] p-4">
                <p className="font-medium">Add a minimal child profile</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only basic identity fields are stored here. Do not add medical, allergy, insurance, or payment details.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-child-first-name">First name</Label>
                    <Input
                      id="new-child-first-name"
                      value={newChildFirstName}
                      onChange={(event) => setNewChildFirstName(event.target.value)}
                      placeholder="Ava"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-child-last-name">Last name optional</Label>
                    <Input
                      id="new-child-last-name"
                      value={newChildLastName}
                      onChange={(event) => setNewChildLastName(event.target.value)}
                      placeholder="Messinger"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-child-dob">DOB optional</Label>
                    <Input
                      id="new-child-dob"
                      type="date"
                      value={newChildDob}
                      onChange={(event) => setNewChildDob(event.target.value)}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  className="mt-4"
                  onClick={createChildProfile}
                  disabled={creatingChild || !newChildFirstName.trim()}
                >
                  {creatingChild ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                  Add and select child
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      case "timing":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Timing and reminder
              </CardTitle>
              <CardDescription>
                Tell SignupAssist when the signup window matters. Email is available now; SMS remains disabled until configured.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="registration-opens-at">Registration opens at</Label>
                  <Input
                    id="registration-opens-at"
                    type="datetime-local"
                    value={registrationOpensAt}
                    onChange={(event) => setRegistrationOpensAt(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reminder-minutes">Reminder minutes before</Label>
                  <Input
                    id="reminder-minutes"
                    inputMode="numeric"
                    value={reminderMinutes}
                    onChange={(event) => setReminderMinutes(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <Checkbox
                    checked={reminderEmail}
                    onCheckedChange={(checked) => setReminderEmail(checked === true)}
                  />
                  Email reminder
                </label>
                <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
                  <Checkbox checked={false} disabled />
                  SMS disabled until supported
                </label>
              </div>
            </CardContent>
          </Card>
        );
      case "safety":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Safety limits
              </CardTitle>
              <CardDescription>
                SignupAssist pauses for login, payment, waivers, medical questions, provider uncertainty, price changes, and final submit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="price-cap">Max total price cap</Label>
                  <Input
                    id="price-cap"
                    inputMode="decimal"
                    value={priceCap}
                    onChange={(event) => setPriceCap(event.target.value)}
                    placeholder="250"
                  />
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Provider readiness level</p>
                  <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${providerReadinessClass(readiness)}`}>
                    {readiness}
                  </span>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Live automation policy</p>
                  <p className="mt-2 text-sm font-medium">{providerLearningSummary.automationPolicy.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Unattended provider execution stays blocked unless API or written permission is recorded.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Readiness preflight</p>
                    <p className="text-sm text-muted-foreground">
                      These checks create today's supervised packet and prepare future set-and-forget safely.
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

              <div className="grid gap-4 lg:grid-cols-2">
                <SafetyList title="Allowed actions" items={selectedPlaybook.allowedActions || DEFAULT_ALLOWED_ACTIONS} />
                <SafetyList title="Stop conditions" items={selectedPlaybook.stopConditions || DEFAULT_STOP_CONDITIONS} />
              </div>
            </CardContent>
          </Card>
        );
      case "learning":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Provider learning
              </CardTitle>
              <CardDescription>
                This run can improve future provider playbooks without sending child PII into learning by default.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {SET_AND_FORGET_LADDER.map((item) => (
                  <div key={item} className="rounded-lg border bg-background p-4">
                    <p className="text-sm font-semibold">{item}</p>
                  </div>
                ))}
              </div>

              <Alert className="border-primary/20 bg-[hsl(var(--secondary))]">
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Provider status: {readiness}</AlertTitle>
                <AlertDescription>
                  {providerLearningSummary.automationPolicy.copy} SignupAssist can learn redacted provider signals such as pause reasons, matched fields, and fixture gaps. It does not learn child PII, credentials, tokens, payment data, or medical/allergy details by default.
                </AlertDescription>
              </Alert>

              <SafetyList
                title="What this run can help learn"
                items={[
                  "Which provider playbook recognized the signup path.",
                  "Where the helper paused and why.",
                  "Which field mappings or fixture gaps need provider review.",
                ]}
              />

              <label className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm">
                <Checkbox
                  checked={learningOptIn}
                  onCheckedChange={(checked) => setLearningOptIn(checked === true)}
                />
                <span>
                  <span className="block font-medium">Opt in to redacted learning signals for this provider</span>
                  <span className="mt-1 block text-muted-foreground">
                    Useful for provider readiness scoring. Full set-and-forget remains future-gated by verified providers and signed mandates.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>
        );
      case "review":
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Review and create
              </CardTitle>
              <CardDescription>
                Create today's supervised run packet. Copy packet remains secondary after the run is saved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!subscriptionUsable && (
                <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>Membership required</AlertTitle>
                  <AlertDescription>
                    Real supervised autopilot runs require an active {AUTOPILOT_PRICE_LABEL} membership.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <SummaryTile icon={<Target className="h-3.5 w-3.5" />} label="Activity" value={targetProgram} />
                <SummaryTile icon={<Sparkles className="h-3.5 w-3.5" />} label="Provider" value={selectedPlaybook.name} />
                <SummaryTile icon={<UserRound className="h-3.5 w-3.5" />} label="Child" value={childLabel(selectedChild)} />
                <SummaryTile icon={<Clock3 className="h-3.5 w-3.5" />} label="Reminder" value={`${reminderMinutesValue} minutes before`} />
                <SummaryTile icon={<CircleDollarSign className="h-3.5 w-3.5" />} label="Price cap" value={maxTotalCents ? `$${maxTotalCents / 100}` : "No cap"} />
                <SummaryTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Readiness" value={`${readinessScore}% ready`} />
              </div>

              <Alert>
                <PauseCircle className="h-4 w-4" />
                <AlertTitle>Parent approval gates stay active</AlertTitle>
                <AlertDescription>
                  Login, payment, waivers, medical questions, provider uncertainty, price changes, and final submit all pause for parent review.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-2 sm:flex-row">
                {createdPacket ? (
                  <Button type="button" onClick={() => navigate("/dashboard")}>
                    <CheckCircle2 className="h-4 w-4" />
                    View dashboard
                  </Button>
                ) : (
                  <Button
                    onClick={createRun}
                    disabled={creatingRun || !subscriptionUsable || !detailsReady}
                  >
                    {creatingRun ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ClipboardCheck className="h-4 w-4" />
                    )}
                    Create supervised run
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyRunPacket(createdPacket || runPacketPreview)}
                  disabled={!safeTargetUrl || !subscriptionUsable}
                >
                  <Clipboard className="h-4 w-4" />
                  Copy packet
                </Button>
                {!createdPacket && (
                  <Button type="button" variant="outline" onClick={() => navigate("/dashboard")}>
                    Dashboard
                  </Button>
                )}
              </div>

              {createdPacket && (
                <Alert className="border-[#b9e5c7] bg-[#eaf7ef]">
                  <CheckCircle2 className="h-4 w-4 text-[#2f855a]" />
                  <AlertTitle>Supervised run packet created</AlertTitle>
                  <AlertDescription>
                    Run {createdRunId ? createdRunId : "saved"} is ready for your dashboard/history where supported.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        );
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">
              V1 supervised autopilot
            </Badge>
            <h1 className="text-3xl font-bold tracking-normal text-primary sm:text-4xl">
              Supervised Autopilot setup
            </h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Create a parent-controlled run packet from your signup intent. Full set-and-forget is a future verified-provider and signed-mandate mode, not live today.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            <Clock3 className="h-4 w-4" />
            Scheduled runs
          </Button>
        </div>

        <section className="mb-6 rounded-lg border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${providerReadinessClass(readiness)}`}>
              Provider status: {readiness}
            </span>
            {intentId && <Badge variant="secondary">Loaded from signup intent</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile icon={<Search className="h-3.5 w-3.5" />} label="Finder" value={finderVenue || finderActivity || "Manual setup"} />
            <SummaryTile icon={<Target className="h-3.5 w-3.5" />} label="Activity" value={targetProgram} />
            <SummaryTile icon={<Sparkles className="h-3.5 w-3.5" />} label="Provider" value={selectedPlaybook.name} />
            <SummaryTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Readiness" value={`${readinessScore}% ready`} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
          <WizardRail
            activeStep={activeStep}
            completed={Boolean(createdPacket)}
            onStepChange={setActiveStep}
          />

          <div className="space-y-4">
            {renderStep()}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                disabled={activeStep === 0}
              >
                Back
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                {activeStep < WIZARD_STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => setActiveStep((current) => Math.min(WIZARD_STEPS.length - 1, current + 1))}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : createdPacket ? (
                  <Button type="button" onClick={() => navigate("/dashboard")}>
                    <CheckCircle2 className="h-4 w-4" />
                    View dashboard
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={createRun}
                    disabled={creatingRun || !subscriptionUsable || !detailsReady}
                  >
                    {creatingRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                    Create supervised run
                  </Button>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <BillingCard
              compact
              userId={user?.id}
              returnPath={autopilotReturnPath}
              onSubscriptionChange={setSubscription}
            />

            <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PauseCircle className="h-5 w-5 text-primary" />
                  Parent approval gates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>SignupAssist pauses for login, payment, waivers, medical questions, provider uncertainty, price changes, and final submit.</p>
                <p>{SUPERVISED_AUTOPILOT_BILLING_COPY.noSuccessFee} {SUPERVISED_AUTOPILOT_BILLING_COPY.providerFee}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Set-and-forget ladder</CardTitle>
                <CardDescription>Future automation is gated by provider readiness and signed mandates.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {SET_AND_FORGET_LADDER.map((item) => (
                  <div key={item} className="rounded-lg border bg-background p-3">
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Run history</CardTitle>
                <CardDescription>Recent supervised setup records.</CardDescription>
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
