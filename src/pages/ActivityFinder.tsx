import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Link as LinkIcon,
  Loader2,
  MapPin,
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
import { Header } from "@/components/Header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  activityFinderStatusLabel,
  activityFinderStatusTone,
  searchActivityFinder,
  type ActivityFinderParsed,
  type ActivityFinderResponse,
  type ActivityFinderResult,
  type ActivityFinderStatus,
} from "@/lib/activityFinder";
import {
  buildAutopilotIntentPath,
  buildSignupIntentFromFinderResult,
  createSignupIntent,
} from "@/lib/signupIntent";
import { showErrorToast } from "@/lib/toastHelpers";

type SearchFieldKey =
  | "activity"
  | "provider"
  | "location"
  | "ageGrade"
  | "season"
  | "priceCap"
  | "registrationStatus";

type SearchFields = Record<SearchFieldKey, string>;

const emptyFields: SearchFields = {
  activity: "",
  provider: "",
  location: "",
  ageGrade: "",
  season: "",
  priceCap: "",
  registrationStatus: "",
};

const examples = [
  "soccer at Keva in Madison for age 9",
  "swim lessons at the YMCA for my 7 year old",
  "summer camp near me for age 8",
];

const registrationStatusOptions = [
  "Open now",
  "Opens soon",
  "Waitlist ok",
];

const PENDING_ACTIVITY_FINDER_INTENT_KEY = "signupassist:pendingActivityFinderIntent";
const PENDING_ACTIVITY_FINDER_INTENT_TTL_MS = 15 * 60 * 1000;

function composeStructuredQuery(fields: SearchFields) {
  const pieces = [
    fields.activity,
    fields.provider ? `at ${fields.provider}` : "",
    fields.location ? `near ${fields.location}` : "",
    fields.ageGrade ? `for ${fields.ageGrade}` : "",
    fields.season ? `during ${fields.season}` : "",
    fields.priceCap ? `under ${fields.priceCap}` : "",
    fields.registrationStatus ? `registration ${fields.registrationStatus.toLowerCase()}` : "",
  ].filter(Boolean);

  return pieces.join(" ");
}

function locationLabel(parsed?: ActivityFinderParsed | null) {
  if (!parsed?.city) return null;
  return [parsed.city, parsed.state].filter(Boolean).join(", ");
}

function ageLabel(parsed?: ActivityFinderParsed | null) {
  if (!parsed) return null;
  if (parsed.ageYears !== null) return `Age ${parsed.ageYears}`;
  return parsed.grade;
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function resultTargetIsSafe(result: ActivityFinderResult) {
  return Boolean(result.targetUrl && isHttpsUrl(result.targetUrl));
}

function optionalString(result: ActivityFinderResult, key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(result: ActivityFinderResult, key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalStringArray(result: ActivityFinderResult, key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getResultHandoffEligibility(result: ActivityFinderResult, signupLink: string) {
  if (result.status === "need_more_detail") {
    return {
      canContinue: false,
      label: "Add missing details",
      hint: "Search again after adding the missing details.",
    };
  }

  if (result.status === "needs_signup_link") {
    const candidateLink = signupLink || result.targetUrl || "";
    const linkReady = isHttpsUrl(candidateLink);
    return {
      canContinue: linkReady,
      label: linkReady ? "Prepare with this link" : "Paste signup link",
      hint: linkReady
        ? "This will create a secure signup intent."
        : "Paste the public HTTPS registration page before preparing a signup.",
    };
  }

  const safeTarget = resultTargetIsSafe(result);
  if (!safeTarget) {
    return {
      canContinue: false,
      label: "Confirm signup link",
      hint: "We need a public HTTPS registration page before preparing a signup.",
    };
  }

  switch (result.status) {
    case "tested_fast_path":
      return {
        canContinue: true,
        label: "Prepare signup",
        hint: "This known path opens a supervised setup.",
      };
    case "guided_autopilot":
      return {
        canContinue: true,
        label: "Prepare guided signup",
        hint: "This starts supervised guided setup. Sensitive steps still pause.",
      };
  }
}

function statusIcon(status: ActivityFinderStatus) {
  switch (status) {
    case "tested_fast_path":
      return <Zap className="h-5 w-5 text-primary" />;
    case "guided_autopilot":
      return <Sparkles className="h-5 w-5 text-primary" />;
    case "needs_signup_link":
      return <LinkIcon className="h-5 w-5 text-[#d9822b]" />;
    case "need_more_detail":
      return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

function SearchPill({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:border-primary/50 hover:text-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function StructuredField({
  id,
  label,
  value,
  placeholder,
  icon,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  icon: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-lg bg-background"
      />
    </div>
  );
}

function ParsedChip({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <span
      className={[
        "rounded-full border px-3 py-1 text-sm",
        value === null || value === undefined || value === ""
          ? "border-dashed text-muted-foreground"
          : "bg-card text-foreground shadow-sm",
      ].join(" ")}
    >
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value || "Needed"}</span>
    </span>
  );
}

function LoadingResults() {
  return (
    <div className="space-y-4" aria-label="Loading activity results">
      {[0, 1].map((item) => (
        <Card key={item} className="overflow-hidden">
          <CardContent className="space-y-4 p-5">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-6 w-3/4 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-10 w-40 rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ResultCard({
  result,
  resultId,
  parsed,
  primary = false,
  onContinue,
  disabled = false,
  signupLink,
  onSignupLinkChange,
}: {
  result: ActivityFinderResult;
  resultId: string;
  parsed: ActivityFinderParsed;
  primary?: boolean;
  onContinue: (result: ActivityFinderResult, confirmedUrl?: string) => void | Promise<void>;
  disabled?: boolean;
  signupLink: string;
  onSignupLinkChange: (value: string) => void;
}) {
  const statusLabel = activityFinderStatusLabel(result.status);
  const statusTone = activityFinderStatusTone(result.status);
  const parsedLocation = locationLabel(parsed);
  const parsedAge = ageLabel(parsed);
  const confidence = optionalNumber(result, "confidence");
  const sourceFreshness = optionalString(result, "sourceFreshness");
  const providerReadiness = optionalString(result, "providerReadiness");
  const ageGradeFit = optionalString(result, "ageGradeFit") || parsedAge;
  const missingDetails = [
    ...optionalStringArray(result, "missingDetails"),
    ...(result.status === "need_more_detail" ? parsed.missingFields : []),
  ].filter((item, index, items) => item && items.indexOf(item) === index);
  const handoff = getResultHandoffEligibility(result, signupLink);
  const canContinue = !disabled && handoff.canContinue;
  const title = result.activityLabel || result.venueName || "Activity signup match";
  const venue = result.venueName || result.providerName || parsed.venue;
  const location = result.address || parsedLocation;

  return (
    <Card className={primary ? "border-primary/30 shadow-sm" : "shadow-sm"}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {primary && <Badge variant="secondary">Best match</Badge>}
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                {statusLabel}
              </span>
              {providerReadiness && (
                <span className="rounded-full border border-[#b9e5c7] bg-[#eaf7ef] px-2.5 py-1 text-xs font-semibold text-[#2f855a]">
                  {providerReadiness}
                </span>
              )}
            </div>
            <CardTitle className="text-2xl tracking-normal">{title}</CardTitle>
            <CardDescription className="mt-2 flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:items-center">
              {result.providerName && <span>{result.providerName}</span>}
              {venue && <span>{venue}</span>}
              {location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {location}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="rounded-full border bg-background p-2">
            {statusIcon(result.status)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-[hsl(var(--secondary))] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Age fit</p>
            <p className="mt-1 text-sm font-semibold">{ageGradeFit || "Confirm fit"}</p>
          </div>
          <div className="rounded-lg border bg-[hsl(var(--secondary))] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confidence</p>
            <p className="mt-1 text-sm font-semibold">
              {confidence !== null ? `${Math.round(confidence * 100)}%` : primary ? "Best available" : "Review"}
            </p>
          </div>
          <div className="rounded-lg border bg-[hsl(var(--secondary))] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Freshness</p>
            <p className="mt-1 text-sm font-semibold">{sourceFreshness || "Live check"}</p>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-4">
          <p className="text-sm font-semibold">Why this match</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.explanation}</p>
        </div>

        {missingDetails.length > 0 && (
          <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Missing detail</AlertTitle>
            <AlertDescription>
              Add {missingDetails.join(", ")} above, then search again for a safer match.
            </AlertDescription>
          </Alert>
        )}

        {result.status === "needs_signup_link" && (
          <div className="space-y-2">
            <Label htmlFor={`signup-link-${resultId}`}>Confirm signup link</Label>
            <Input
              id={`signup-link-${resultId}`}
              value={signupLink}
              onChange={(event) => onSignupLinkChange(event.target.value)}
              placeholder="https://provider.example.com/signup"
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground">
              Paste the public HTTPS provider signup page. SignupAssist still creates a server-side intent and keeps it out of the browser URL.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            onClick={() => onContinue(result, result.status === "needs_signup_link" ? signupLink : undefined)}
            disabled={!canContinue}
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardCheck className="h-4 w-4" />
            )}
            {handoff.label}
            {canContinue && <ArrowRight className="h-4 w-4" />}
          </Button>
          <p className="text-sm text-muted-foreground">{handoff.hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrustPanel({ authenticated }: { authenticated: boolean }) {
  const trustItems = [
    { icon: <ShieldCheck className="h-4 w-4" />, title: "Parent controlled", copy: "You approve sensitive steps." },
    { icon: <Clock3 className="h-4 w-4" />, title: "Sensitive steps pause", copy: "Login, waivers, payment, and final submit stop for review." },
    { icon: <CircleDollarSign className="h-4 w-4" />, title: "No card numbers stored", copy: "Provider checkout stays with the provider." },
    { icon: <ClipboardCheck className="h-4 w-4" />, title: "All actions logged", copy: "Prepared runs keep an audit trail." },
    { icon: <Sparkles className="h-4 w-4" />, title: "Provider learning", copy: "Future set-and-forget depends on verified provider playbooks." },
  ];

  return (
    <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      {!authenticated && (
        <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
          <UserRound className="h-4 w-4" />
          <AlertTitle>Sign in to prepare a signup</AlertTitle>
          <AlertDescription>
            Searching works now. Creating the secure signup intent requires your account.
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Signup readiness</CardTitle>
          <CardDescription>SignupAssist prepares the path. You stay in control.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {trustItems.map((item) => (
            <div key={item.title} className="flex gap-3 rounded-lg border bg-background p-3">
              <div className="mt-0.5 text-primary">{item.icon}</div>
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.copy}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold">What happens next</p>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">1.</span>
              Search for the signup path.
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">2.</span>
              Prepare a secure signup intent.
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-foreground">3.</span>
              Confirm details in supervised Autopilot.
            </li>
          </ol>
        </CardContent>
      </Card>
    </aside>
  );
}

interface PendingActivityFinderIntent {
  expiresAt: number;
  query: string;
  parsed: ActivityFinderParsed;
  result: ActivityFinderResult;
}

function readPendingActivityFinderIntent(): PendingActivityFinderIntent | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ACTIVITY_FINDER_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingActivityFinderIntent;
    if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(PENDING_ACTIVITY_FINDER_INTENT_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(PENDING_ACTIVITY_FINDER_INTENT_KEY);
    return null;
  }
}

function storePendingActivityFinderIntent(pending: Omit<PendingActivityFinderIntent, "expiresAt">) {
  sessionStorage.setItem(
    PENDING_ACTIVITY_FINDER_INTENT_KEY,
    JSON.stringify({
      ...pending,
      expiresAt: Date.now() + PENDING_ACTIVITY_FINDER_INTENT_TTL_MS,
    }),
  );
}

export default function ActivityFinder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [fields, setFields] = useState<SearchFields>(emptyFields);
  const [loading, setLoading] = useState(false);
  const [creatingIntent, setCreatingIntent] = useState(false);
  const [response, setResponse] = useState<ActivityFinderResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signupLinks, setSignupLinks] = useState<Record<string, string>>({});
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  const parsedLocation = locationLabel(response?.parsed);
  const parsedAge = ageLabel(response?.parsed);
  const structuredQuery = useMemo(() => composeStructuredQuery(fields), [fields]);
  const results = useMemo(
    () => [
      ...(response?.bestMatch ? [response.bestMatch] : []),
      ...(response?.otherMatches || []),
    ],
    [response],
  );
  const isOutOfScope = Boolean(response?.outOfScope);
  const hasNoResults = Boolean(response && results.length === 0 && !isOutOfScope);
  const hasMissingDetail = Boolean(
    !isOutOfScope &&
      (response?.parsed.missingFields.length || results.some((result) => result.status === "need_more_detail")),
  );

  const updateField = (key: SearchFieldKey, value: string) => {
    const nextFields = { ...fields, [key]: value };
    setFields(nextFields);
    const nextQuery = composeStructuredQuery(nextFields);
    if (nextQuery) setQuery(nextQuery);
  };

  const createIntentFromSelection = useCallback(async (
    intentQuery: string,
    parsed: ActivityFinderParsed,
    result: ActivityFinderResult,
  ) => {
    const payload = buildSignupIntentFromFinderResult({
      query: intentQuery,
      parsed,
      result,
    });

    if (!payload) return null;

    const intent = await createSignupIntent(payload);
    navigate(buildAutopilotIntentPath(intent.id));
    return intent;
  }, [navigate]);

  useEffect(() => {
    if (!user || creatingIntent) return;
    const pending = readPendingActivityFinderIntent();
    if (!pending) return;

    const handoff = getResultHandoffEligibility(pending.result, "");
    if (!handoff.canContinue) {
      sessionStorage.removeItem(PENDING_ACTIVITY_FINDER_INTENT_KEY);
      return;
    }

    setCreatingIntent(true);
    createIntentFromSelection(pending.query, pending.parsed, pending.result)
      .then(() => {
        sessionStorage.removeItem(PENDING_ACTIVITY_FINDER_INTENT_KEY);
      })
      .catch((error) => {
        showErrorToast(
          "Could not start signup setup",
          error instanceof Error ? error.message : "Please try again.",
        );
      })
      .finally(() => setCreatingIntent(false));
  }, [user, creatingIntent, createIntentFromSelection]);

  const applyExample = (example: string) => {
    setQuery(example);
    void runSearch(example);
  };

  const runSearch = async (nextQuery = query) => {
    const trimmed = nextQuery.trim() || structuredQuery.trim();
    if (!trimmed) return;

    setQuery(trimmed);
    setLoading(true);
    setErrorMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const result = await searchActivityFinder(trimmed, session?.access_token);
      setResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      setErrorMessage(message);
      showErrorToast("Activity search failed", message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const continueToSetup = async (result: ActivityFinderResult, confirmedUrl?: string) => {
    const resultForIntent =
      result.status === "needs_signup_link" && confirmedUrl
        ? { ...result, targetUrl: confirmedUrl }
        : result;
    const handoff = getResultHandoffEligibility(resultForIntent, confirmedUrl || "");

    if (!response || !handoff.canContinue) return;

    if (!user) {
      storePendingActivityFinderIntent({
        query,
        parsed: response.parsed,
        result: resultForIntent,
      });
      sessionStorage.setItem("signupassist:returnTo", "/activity-finder");
      navigate("/auth?returnTo=%2Factivity-finder");
      return;
    }

    try {
      setCreatingIntent(true);
      await createIntentFromSelection(query, response.parsed, resultForIntent);
    } catch (error) {
      showErrorToast(
        "Could not start signup setup",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setCreatingIntent(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="secondary" className="mb-3">Activity Finder</Badge>
            <h1 className="text-3xl font-bold tracking-normal text-primary sm:text-4xl">
              Find the signup. Get ready fast.
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              SignupAssist prepares the path. You stay in control.
            </p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
            Future set-and-forget depends on verified provider playbooks.
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card className="border-primary/20 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Search className="h-5 w-5 text-primary" />
                  Search by phrase
                </CardTitle>
                <CardDescription>
                  Type the activity, provider or venue, location, and child age when you know them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <form onSubmit={handleSubmit} className="flex flex-col gap-3 lg:flex-row">
                  <div className="relative flex-1">
                    <Label htmlFor="activity-finder-query" className="sr-only">Activity search query</Label>
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="activity-finder-query"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="soccer at Keva in Madison for age 9"
                      className="h-14 rounded-lg pl-11 text-base"
                    />
                  </div>
                  <Button type="submit" size="lg" className="h-14" disabled={loading || !query.trim()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Find signup
                  </Button>
                </form>

                <div className="flex flex-wrap gap-2" aria-label="Example searches">
                  {examples.map((example) => (
                    <SearchPill key={example} onClick={() => applyExample(example)}>
                      {example}
                    </SearchPill>
                  ))}
                </div>

                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAdvancedDetails((current) => !current)}
                    aria-expanded={showAdvancedDetails}
                    aria-controls="activity-finder-advanced-details"
                  >
                    <Target className="h-4 w-4" />
                    {showAdvancedDetails ? "Hide details" : "Add details"}
                  </Button>
                </div>

                {showAdvancedDetails && (
                  <div id="activity-finder-advanced-details" className="space-y-4 rounded-lg border bg-[hsl(var(--secondary))] p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <StructuredField
                        id="activity-field"
                        label="Activity"
                        value={fields.activity}
                        placeholder="Soccer, swim, camp"
                        icon={<Target className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("activity", value)}
                      />
                      <StructuredField
                        id="provider-field"
                        label="Provider or venue"
                        value={fields.provider}
                        placeholder="Keva, YMCA, parks"
                        icon={<Sparkles className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("provider", value)}
                      />
                      <StructuredField
                        id="location-field"
                        label="City or location"
                        value={fields.location}
                        placeholder="Madison, Middleton"
                        icon={<MapPin className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("location", value)}
                      />
                      <StructuredField
                        id="age-grade-field"
                        label="Age or grade"
                        value={fields.ageGrade}
                        placeholder="age 9, grade 3"
                        icon={<UserRound className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("ageGrade", value)}
                      />
                      <StructuredField
                        id="season-field"
                        label="Season or date"
                        value={fields.season}
                        placeholder="summer, July, weekends"
                        icon={<CalendarDays className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("season", value)}
                      />
                      <StructuredField
                        id="price-cap-field"
                        label="Price cap"
                        value={fields.priceCap}
                        placeholder="$250"
                        icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                        onChange={(value) => updateField("priceCap", value)}
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Registration status
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {registrationStatusOptions.map((option) => (
                          <SearchPill
                            key={option}
                            active={fields.registrationStatus === option}
                            onClick={() =>
                              updateField(
                                "registrationStatus",
                                fields.registrationStatus === option ? "" : option,
                              )
                            }
                          >
                            {option}
                          </SearchPill>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <section aria-labelledby="activity-results-heading" className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="activity-results-heading" className="text-2xl font-semibold tracking-normal">
                    Results
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Matches become secure signup intents before Autopilot opens.
                  </p>
                </div>
                {response && (
                  <div className="flex flex-wrap gap-2">
                    <ParsedChip label="Activity" value={response.parsed.activity} />
                    <ParsedChip label="Venue" value={response.parsed.venue || response.bestMatch?.venueName} />
                    <ParsedChip label="Location" value={parsedLocation} />
                    <ParsedChip label="Age" value={parsedAge} />
                  </div>
                )}
              </div>

              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Backend error</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}

              {response?.outOfScope && !loading && (
                <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>Outside current launch scope</AlertTitle>
                  <AlertDescription>
                    {response.outOfScope.message ||
                      "SignupAssist is currently focused on parent-controlled youth activity signups. Adult activity registration is not supported yet."}
                  </AlertDescription>
                </Alert>
              )}

              {!response && !loading && !errorMessage && (
                <Card>
                  <CardContent className="grid gap-5 p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                    <div className="rounded-full border bg-[hsl(var(--secondary))] p-4 text-primary">
                      <Search className="h-7 w-7" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Start with one search</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Try an example or fill the fields above. We will look for a signup path without sending sensitive family details.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {loading && <LoadingResults />}

              {hasNoResults && !loading && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold">No results yet</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add a venue, city, or age and search again. If you already have a provider link, paste it into the provider field.
                    </p>
                  </CardContent>
                </Card>
              )}

              {hasMissingDetail && !loading && (
                <Alert className="border-[#f3d8b6] bg-[#fff3e2]">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Missing detail</AlertTitle>
                  <AlertDescription>
                    Add the missing activity, provider, location, or age detail above, then search again before preparing a signup.
                  </AlertDescription>
                </Alert>
              )}

              {response?.bestMatch && !loading && (
                <ResultCard
                  result={response.bestMatch}
                  resultId="best-match"
                  parsed={response.parsed}
                  primary
                  onContinue={continueToSetup}
                  disabled={creatingIntent}
                  signupLink={signupLinks.bestMatch || ""}
                  onSignupLinkChange={(value) => setSignupLinks((current) => ({ ...current, bestMatch: value }))}
                />
              )}

              {response && response.otherMatches.length > 0 && !loading && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Other possible matches</p>
                  {response.otherMatches.map((result, index) => {
                    const key = `${result.venueName || result.activityLabel || "match"}-${index}`;
                    return (
                      <ResultCard
                        key={key}
                        result={result}
                        resultId={`other-match-${index}`}
                        parsed={response.parsed}
                        onContinue={continueToSetup}
                        disabled={creatingIntent}
                        signupLink={signupLinks[key] || ""}
                        onSignupLinkChange={(value) =>
                          setSignupLinks((current) => ({ ...current, [key]: value }))
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <TrustPanel authenticated={Boolean(user)} />
        </section>
      </main>
    </div>
  );
}
