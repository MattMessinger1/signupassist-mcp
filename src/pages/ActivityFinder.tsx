import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/Header";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  activityFinderStatusLabel,
  activityFinderStatusTone,
  searchActivityFinder,
  type ActivityFinderParsed,
  type ActivityFinderResponse,
  type ActivityFinderResult,
} from "@/lib/activityFinder";
import { showErrorToast } from "@/lib/toastHelpers";

const examples = [
  "soccer at Keva in Madison for age 9",
  "swim lessons at the YMCA for my 7 year old",
  "summer camp near me for age 8",
];

function Chip({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") {
    return (
      <span className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground">
        Add {label.toLowerCase()}
      </span>
    );
  }

  return (
    <span className="rounded-full border bg-card px-3 py-1 text-sm text-foreground shadow-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function locationLabel(parsed?: ActivityFinderParsed | null) {
  if (!parsed?.city) return null;
  return [parsed.city, parsed.state].filter(Boolean).join(", ");
}

function ResultCard({
  result,
  primary = false,
  onContinue,
}: {
  result: ActivityFinderResult;
  primary?: boolean;
  onContinue: (result: ActivityFinderResult) => void;
}) {
  const statusLabel = activityFinderStatusLabel(result.status);
  const statusTone = activityFinderStatusTone(result.status);

  return (
    <Card className={primary ? "border-primary/30 shadow-sm" : ""}>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              {primary && <Badge variant="secondary">Best match</Badge>}
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                {statusLabel}
              </span>
            </div>
            <CardTitle className="text-xl">
              {result.venueName || result.activityLabel || "Add a little more detail"}
            </CardTitle>
            {result.address && (
              <CardDescription className="mt-2 flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {result.address}
              </CardDescription>
            )}
          </div>
          {result.status === "tested_fast_path" ? (
            <Zap className="h-6 w-6 text-primary" />
          ) : result.status === "guided_autopilot" ? (
            <Sparkles className="h-6 w-6 text-primary" />
          ) : (
            <LinkIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{result.explanation}</p>
        {result.activityLabel && (
          <div className="rounded-lg border bg-secondary/60 p-3 text-sm">
            <span className="text-muted-foreground">Activity: </span>
            <span className="font-medium">{result.activityLabel}</span>
          </div>
        )}
        <Button
          className="w-full sm:w-auto"
          onClick={() => onContinue(result)}
          disabled={result.status === "need_more_detail"}
        >
          {result.ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ActivityFinder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ActivityFinderResponse | null>(null);

  const parsedLocation = locationLabel(response?.parsed);
  const ageLabel = useMemo(() => {
    if (!response?.parsed) return null;
    return response.parsed.ageYears !== null
      ? `Age ${response.parsed.ageYears}`
      : response.parsed.grade;
  }, [response?.parsed]);

  const runSearch = async (nextQuery = query) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;

    setQuery(trimmed);
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const result = await searchActivityFinder(trimmed, user?.id, session?.access_token);
      setResponse(result);
    } catch (error) {
      showErrorToast(
        "Activity search failed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const continueToSetup = (result: ActivityFinderResult) => {
    const params = new URLSearchParams();
    params.set("finder", "1");
    params.set("finderQuery", query);
    params.set("finderStatus", result.status);
    params.set("providerKey", result.providerKey || "generic");
    params.set("providerName", result.providerName || "Guided Autopilot");
    params.set("targetUrl", result.targetUrl || "");
    params.set("activity", result.activityLabel || response?.parsed.activity || "");
    params.set("venue", result.venueName || response?.parsed.venue || "");
    params.set("address", result.address || "");
    params.set("age", response?.parsed.ageYears !== null && response?.parsed.ageYears !== undefined ? String(response.parsed.ageYears) : "");
    params.set("location", parsedLocation || "");
    navigate(`/autopilot?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto max-w-6xl px-4 py-10">
        <section className="mx-auto max-w-4xl text-center">
          <Badge variant="secondary" className="mb-4">
            Activity Finder
          </Badge>
          <h1 className="text-4xl font-bold tracking-normal text-primary sm:text-5xl">
            Find the signup. Get ready fast.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Type the activity, venue, and age in one line. We’ll find the best signup path,
            remind you before it opens, and help fill the boring parts.
          </p>

          <form onSubmit={handleSubmit} className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
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

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void runSearch(example)}
                className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary"
              >
                {example}
              </button>
            ))}
          </div>
        </section>

        {response && (
          <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium">We found the important pieces</p>
                  {parsedLocation && (
                    <p className="text-sm text-muted-foreground">
                      Searching near <span className="font-medium text-foreground">{parsedLocation}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip label="Activity" value={response.parsed.activity} />
                  <Chip label="Venue" value={response.parsed.venue || response.bestMatch?.venueName} />
                  <Chip label="Location" value={parsedLocation} />
                  <Chip label="Age" value={ageLabel} />
                </div>
              </div>

              {response.bestMatch && (
                <ResultCard result={response.bestMatch} primary onContinue={continueToSetup} />
              )}

              {response.otherMatches.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Other possible matches</p>
                  {response.otherMatches.map((result, index) => (
                    <ResultCard
                      key={`${result.venueName}-${index}`}
                      result={result}
                      onContinue={continueToSetup}
                    />
                  ))}
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BellRing className="h-5 w-5 text-primary" />
                    We won’t let you forget
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Set a 10-minute reminder before registration opens.</p>
                  <p>Open the reminder and jump straight back into your prepared signup flow.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserRound className="h-5 w-5 text-primary" />
                    Reuse family info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>Your child and contact details can be reused across future signups.</p>
                  <p>Payment, waivers, medical questions, and final submit still pause for you.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Parent-controlled
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#2f855a]" />
                    Safe fields can be filled quickly.
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-[#d9822b]" />
                    Sensitive steps pause for review.
                  </div>
                </CardContent>
              </Card>
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
