import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle, Chrome, ClipboardCheck, Clock, CreditCard, ExternalLink, Eye, FileText, Home, Loader2, PauseCircle, Play, RefreshCw, Search, Settings, ShieldCheck, Sparkles, UserRound, Users, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { showPromptToast, showErrorToast } from '@/lib/toastHelpers';
import { format, formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { prompts } from '@/lib/prompts';
import { BillingCard } from '@/components/BillingCard';
import { buildAutopilotIntentPath } from '@/lib/signupIntent';
import { getProviderReadinessSummary, type ProviderReadinessLevel } from '@/lib/providerLearning';
import { isTestRoutesEnabled } from '@/lib/featureFlags';
import {
  isCompleteStatus,
  isFailedOrFallbackStatus,
  isPausedStatus,
  normalizeRunStatus,
  runStatusLabel,
  runStatusTone,
  summarizeAuditEvents,
} from '@/lib/dashboardStatus';

interface Plan {
  id: string;
  program_ref: string;
  status: string;
  opens_at: string;
  created_at: string;
  child: {
    name: string;
  };
  executions: PlanExecution[];
}

interface PlanExecution {
  id: string;
  started_at: string;
  finished_at?: string;
  result?: string;
  amount_cents?: number;
  confirmation_ref?: string;
}

interface ExecutionStats {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  success_rate: number;
}

interface AutopilotDashboardRun {
  id: string;
  provider_key: string;
  provider_name: string;
  status: string;
  target_program: string | null;
  target_url: string;
  created_at: string;
  updated_at: string;
  child_id: string | null;
  caps: unknown;
  audit_events: unknown;
  children?: {
    first_name: string;
    last_name: string;
  } | null;
}

type DashboardSectionKey =
  | 'ready'
  | 'openingSoon'
  | 'scheduled'
  | 'paused'
  | 'completed'
  | 'fallback';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capsRecord(run: AutopilotDashboardRun) {
  return isRecord(run.caps) ? run.caps : {};
}

function providerLearningRecord(run: AutopilotDashboardRun) {
  const providerLearning = capsRecord(run).provider_learning;
  return isRecord(providerLearning) ? providerLearning : {};
}

function stringFromCaps(run: AutopilotDashboardRun, key: string) {
  const value = capsRecord(run)[key];
  return typeof value === 'string' ? value : null;
}

function numberFromCaps(run: AutopilotDashboardRun, key: string) {
  const value = capsRecord(run)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function providerReadinessForRun(run: AutopilotDashboardRun): ProviderReadinessLevel {
  const providerReadiness = providerLearningRecord(run).provider_readiness;
  if (typeof providerReadiness === 'string') {
    return getProviderReadinessSummary(run.provider_key).readinessLevel === providerReadiness
      ? providerReadiness as ProviderReadinessLevel
      : getProviderReadinessSummary(run.provider_key).readinessLevel;
  }
  return getProviderReadinessSummary(run.provider_key).readinessLevel;
}

function providerReadinessCopy(readiness: ProviderReadinessLevel) {
  if (readiness === 'navigation_verified') {
    return 'Verified navigation means fixture-tested safe flow coverage, not unattended live provider submit.';
  }
  if (readiness === 'fill_safe') {
    return 'Beta means conservative fill-only or high-pause mode.';
  }
  if (readiness === 'recognized' || readiness === 'unknown') {
    return 'Generic means SignupAssist pauses more often and makes no speed guarantees.';
  }
  return 'Delegated signup is future-only unless readiness and mandate checks pass.';
}

function providerReadinessTone(readiness: ProviderReadinessLevel): 'default' | 'secondary' | 'outline' {
  if (readiness === 'navigation_verified') return 'default';
  if (readiness === 'fill_safe' || readiness === 'recognized') return 'secondary';
  return 'outline';
}

function childLabel(run: AutopilotDashboardRun) {
  if (!run.children) return 'Choose during run';
  return `${run.children.first_name} ${run.children.last_name}`.trim() || 'Choose during run';
}

function registrationOpensAt(run: AutopilotDashboardRun) {
  return stringFromCaps(run, 'registration_opens_at');
}

function readinessScore(run: AutopilotDashboardRun) {
  return numberFromCaps(run, 'readiness_score');
}

function maxTotalCents(run: AutopilotDashboardRun) {
  return numberFromCaps(run, 'max_total_cents');
}

function reminderSummary(run: AutopilotDashboardRun) {
  const reminder = capsRecord(run).reminder;
  if (!isRecord(reminder)) {
    return 'Reminder prepared. Manual reminder recommended.';
  }

  const minutes = typeof reminder.minutesBefore === 'number' ? reminder.minutesBefore : 10;
  const channels = Array.isArray(reminder.channels)
    ? reminder.channels.filter((channel): channel is string => typeof channel === 'string')
    : ['email'];
  const hasSms = channels.includes('sms');
  const channelLabel = channels.length ? channels.join(', ') : 'email';

  return hasSms
    ? `Reminder prepared ${minutes} minutes before by ${channelLabel}.`
    : `Reminder prepared ${minutes} minutes before by ${channelLabel}. Manual reminder recommended. SMS disabled until configured.`;
}

function isOpeningSoon(run: AutopilotDashboardRun) {
  const opensAt = registrationOpensAt(run);
  if (!opensAt || isCompleteStatus(run.status) || isFailedOrFallbackStatus(run.status)) return false;
  const opensTime = new Date(opensAt).getTime();
  if (!Number.isFinite(opensTime)) return false;
  const now = Date.now();
  return opensTime >= now && opensTime <= now + 1000 * 60 * 60 * 72;
}

function reviewPathForRun(run: AutopilotDashboardRun) {
  const signupIntentId = providerLearningRecord(run).signup_intent_id;
  return typeof signupIntentId === 'string' && signupIntentId
    ? buildAutopilotIntentPath(signupIntentId)
    : '/autopilot';
}

function providerUrl(run: AutopilotDashboardRun) {
  try {
    const url = new URL(run.target_url);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not scheduled yet';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, 'PPP p') : 'Not scheduled yet';
}

function priceCapLabel(run: AutopilotDashboardRun) {
  const cents = maxTotalCents(run);
  return typeof cents === 'number' ? `$${(cents / 100).toFixed(0)}` : 'No cap recorded';
}

function lastAuditSummary(run: AutopilotDashboardRun) {
  return summarizeAuditEvents(run.audit_events, 1)[0] || 'Audit trail prepared';
}

function RunCard({
  run,
  auditOpen,
  onToggleAudit,
  onReview,
  onResume,
  onViewAudit,
}: {
  run: AutopilotDashboardRun;
  auditOpen: boolean;
  onToggleAudit: () => void;
  onReview: () => void;
  onResume: () => void;
  onViewAudit: () => void;
}) {
  const readiness = providerReadinessForRun(run);
  const readinessSummary = getProviderReadinessSummary(run.provider_key);
  const score = readinessScore(run);
  const opensAt = registrationOpensAt(run);
  const auditSummaries = summarizeAuditEvents(run.audit_events, 4);
  const url = providerUrl(run);
  const normalizedStatus = normalizeRunStatus(run.status);
  const canResume = [
    'scheduled',
    'waiting_for_registration_open',
    'running',
    'paused_for_parent',
    'registration_review_required',
    'payment_review_required',
    'payment_paused',
    'waiver_review_required',
    'final_submit_review_required',
  ].includes(normalizedStatus);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-lg">
              {run.target_program || 'Signup run packet'}
            </CardTitle>
            <CardDescription className="mt-1">
              {run.provider_name} • {childLabel(run)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
            <Badge variant={providerReadinessTone(readiness)}>{readiness}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Registration opens</p>
            <p className="mt-1 text-sm font-medium">{formatDateTime(opensAt)}</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Readiness score</p>
            <p className="mt-1 text-sm font-medium">{typeof score === 'number' ? `${score}%` : 'Not scored yet'}</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Price cap</p>
            <p className="mt-1 text-sm font-medium">{priceCapLabel(run)}</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Last audit event</p>
            <p className="mt-1 text-sm font-medium">{lastAuditSummary(run)}</p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Alert>
            <Bell className="h-4 w-4" />
            <AlertDescription>{reminderSummary(run)}</AlertDescription>
          </Alert>
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              {providerReadinessCopy(readiness)} Fixture coverage: {readinessSummary.fixtureCoverage.coverageLabel}. Live automation policy: {readinessSummary.automationPolicy.label}.
            </AlertDescription>
          </Alert>
        </div>

        {auditOpen && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" />
              Redacted audit summary
            </div>
            {auditSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit events have been written yet.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {auditSummaries.map((summary) => (
                  <li key={summary}>{summary}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onReview}>
            <Eye className="h-4 w-4" />
            Review setup
          </Button>
          {canResume && (
            <Button variant="outline" size="sm" onClick={onResume}>
              <Play className="h-4 w-4" />
              Resume
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onToggleAudit}>
            <FileText className="h-4 w-4" />
            {auditOpen ? 'Hide audit' : 'View audit'}
          </Button>
          <Button variant="outline" size="sm" onClick={onViewAudit}>
            <ShieldCheck className="h-4 w-4" />
            Audit trail
          </Button>
          {url && (
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open provider
              </a>
            </Button>
          )}
          {['draft', 'ready', 'scheduled', 'waiting_for_registration_open', 'paused_for_parent'].includes(normalizeRunStatus(run.status)) && (
            <Button variant="ghost" size="sm" disabled>
              Cancel if supported
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardRunSection({
  title,
  description,
  icon,
  runs,
  emptyCopy,
  sectionKey,
  expandedAuditRunId,
  onToggleAudit,
  onReview,
  onResume,
  onViewAudit,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  runs: AutopilotDashboardRun[];
  emptyCopy: string;
  sectionKey: DashboardSectionKey;
  expandedAuditRunId: string | null;
  onToggleAudit: (runId: string) => void;
  onReview: (run: AutopilotDashboardRun) => void;
  onResume: (run: AutopilotDashboardRun) => void;
  onViewAudit: (run: AutopilotDashboardRun) => void;
}) {
  const Icon = icon;

  return (
    <section aria-labelledby={`dashboard-section-${sectionKey}`} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`dashboard-section-${sectionKey}`} className="flex items-center gap-2 text-xl font-semibold">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary">{runs.length}</Badge>
      </div>
      {runs.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          {emptyCopy}
        </div>
      ) : (
        <div className="grid gap-4">
          {runs.map((run) => (
            <RunCard
              key={`${sectionKey}-${run.id}`}
              run={run}
              auditOpen={expandedAuditRunId === run.id}
              onToggleAudit={() => onToggleAudit(run.id)}
              onReview={() => onReview(run)}
              onResume={() => onResume(run)}
              onViewAudit={() => onViewAudit(run)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RegistrationDashboard() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<ExecutionStats>({
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    success_rate: 0
  });
  const [autopilotRuns, setAutopilotRuns] = useState<AutopilotDashboardRun[]>([]);
  const [childrenCount, setChildrenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedAuditRunId, setExpandedAuditRunId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const firstName = user?.email?.split('@')[0]?.split(/[._-]/)[0] || 'there';
  const greetingName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const loadPlansData = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Get plans with child info and executions
      const [plansResult, autopilotResult, childrenResult] = await Promise.all([
        supabase
          .from('plans')
          .select(`
            *,
            children:child_id (first_name, last_name),
            plan_executions (*)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('autopilot_runs')
          .select('id, provider_key, provider_name, status, target_program, target_url, created_at, updated_at, child_id, caps, audit_events, children:child_id (first_name, last_name)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(25),
        supabase
          .from('children')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
      ]);

      const { data: plansData, error: plansError } = plansResult;

      if (plansError) throw plansError;
      if (autopilotResult.error) console.warn('Error loading supervised autopilot runs:', autopilotResult.error);
      if (childrenResult.error) console.warn('Error loading children count:', childrenResult.error);

      setAutopilotRuns((autopilotResult.data || []) as AutopilotDashboardRun[]);
      setChildrenCount(childrenResult.count || 0);

      const formattedPlans = plansData?.map(plan => ({
        id: plan.id,
        program_ref: plan.program_ref,
        status: plan.status,
        opens_at: plan.opens_at,
        created_at: plan.created_at,
        child: {
          name: plan.children ? `${plan.children.first_name} ${plan.children.last_name}` : 'Unknown Child'
        },
        executions: plan.plan_executions || []
      })) || [];

      setPlans(formattedPlans);

      // Calculate stats
      const totalExecutions = formattedPlans.reduce((acc, plan) => acc + plan.executions.length, 0);
      const completedExecutions = formattedPlans.reduce((acc, plan) => 
        acc + plan.executions.filter(exec => exec.finished_at && exec.result).length, 0
      );
      const failedExecutions = formattedPlans.reduce((acc, plan) => 
        acc + plan.executions.filter(exec => exec.finished_at && !exec.confirmation_ref).length, 0
      );
      const pendingExecutions = totalExecutions - completedExecutions - failedExecutions;

      setStats({
        total: totalExecutions,
        pending: pendingExecutions,
        completed: completedExecutions,
        failed: failedExecutions,
        success_rate: totalExecutions > 0 ? Math.round((completedExecutions / totalExecutions) * 100) : 0
      });

    } catch (error) {
      console.error('Error loading plans:', error);
      showErrorToast('Error Loading Data', 'Failed to load registration data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    } else if (user) {
      void loadPlansData();
    }
  }, [user, authLoading, loadPlansData, navigate]);

  const dashboardSections = useMemo(() => {
    const ready = autopilotRuns.filter((run) => ['draft', 'ready'].includes(normalizeRunStatus(run.status)));
    const openingSoon = autopilotRuns.filter(isOpeningSoon);
    const scheduled = autopilotRuns.filter((run) =>
      ['scheduled', 'waiting_for_registration_open', 'running', 'provider_learning'].includes(normalizeRunStatus(run.status)),
    );
    const paused = autopilotRuns.filter((run) => isPausedStatus(run.status));
    const completed = autopilotRuns.filter((run) => isCompleteStatus(run.status));
    const fallback = autopilotRuns.filter((run) => isFailedOrFallbackStatus(run.status));

    return { ready, openingSoon, scheduled, paused, completed, fallback };
  }, [autopilotRuns]);

  const providerReadinessCards = useMemo(() => {
    const seen = new Set<string>();
    return autopilotRuns
      .filter((run) => {
        if (seen.has(run.provider_key)) return false;
        seen.add(run.provider_key);
        return true;
      })
      .slice(0, 4)
      .map((run) => ({
        run,
        summary: getProviderReadinessSummary(run.provider_key),
        readiness: providerReadinessForRun(run),
      }));
  }, [autopilotRuns]);

  const toggleAuditRun = (runId: string) => {
    setExpandedAuditRunId((current) => (current === runId ? null : runId));
  };

  const reviewRun = (run: AutopilotDashboardRun) => {
    navigate(reviewPathForRun(run));
  };

  const resumeRun = (run: AutopilotDashboardRun) => {
    navigate(reviewPathForRun(run));
  };

  const viewRunAudit = () => {
    navigate('/mandates');
  };

  const refreshData = async () => {
    setRefreshing(true);
    await loadPlansData();
    setRefreshing(false);
    showPromptToast('dataRefreshed');
  };

  const startSignupJob = async (planId: string) => {
    if (!isTestRoutesEnabled()) {
      showErrorToast(
        'Legacy start disabled',
        'Use Activity Finder and Autopilot to create a supervised run packet. Automated legacy starts are paused for safety.',
      );
      return;
    }

    try {
      const { error } = await supabase.functions.invoke('start-signup-job', {
        body: { plan_id: planId }
      });

      if (error) throw error;

      showPromptToast('jobStarted');

      // Refresh data to show new execution
      await refreshData();
    } catch (error) {
      console.error('Error starting signup job:', error);
      showPromptToast('jobFailed', { variant: 'destructive' });
    }
  };

  const getStatusIcon = (plan: Plan) => {
    const latestExecution = plan.executions[0];
    
    if (!latestExecution) {
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
    
    if (!latestExecution.finished_at) {
      return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
    }
    
    if (latestExecution.confirmation_ref) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  const getStatusText = (plan: Plan) => {
    const latestExecution = plan.executions[0];
    
    if (!latestExecution) return prompts.dashboard.status.ready;
    if (!latestExecution.finished_at) return prompts.dashboard.status.running;
    if (latestExecution.confirmation_ref) return prompts.dashboard.status.completed;
    return prompts.dashboard.status.failed;
  };

  const getStatusVariant = (plan: Plan): 'default' | 'secondary' | 'destructive' => {
    const latestExecution = plan.executions[0];
    
    if (!latestExecution) return 'secondary';
    if (!latestExecution.finished_at) return 'default';
    if (latestExecution.confirmation_ref) return 'secondary';
    return 'destructive';
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-muted-foreground">{prompts.dashboard.loading}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden rounded-lg border bg-card p-3 lg:block">
            <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Parent workspace
            </div>
            {[
              { label: 'Home', icon: Home, action: () => navigate('/dashboard') },
              { label: 'Activity Finder', icon: Search, action: () => navigate('/activity-finder') },
              { label: 'My Children', icon: Users, action: () => navigate('/credentials') },
              { label: 'Billing & Plan', icon: CreditCard, action: () => navigate('/dashboard') },
              { label: 'Chrome Helper', icon: Chrome, action: () => navigate('/autopilot') },
              { label: 'Settings', icon: Settings, action: () => navigate('/credentials') },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-secondary hover:text-primary"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </aside>

          <section>
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Good morning, {greetingName}!</h1>
              <p className="text-muted-foreground">
                We've got things covered. Here's what you need to know today.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={refreshData}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                {prompts.dashboard.refresh}
              </Button>
              <Button variant="accent" onClick={() => navigate('/activity-finder')}>
                <Search className="h-4 w-4 mr-2" />
                Find your activity
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Upcoming registration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">
                {autopilotRuns[0]?.target_program || 'No supervised run scheduled'}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Spots fill fast. SignupAssist prepares the run packet and pauses at sensitive steps.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <UserRound className="h-4 w-4" />
                Child profiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{childrenCount} ready</div>
              <p className="mt-1 text-xs text-muted-foreground">Ready to feed supervised run packets.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Chrome className="h-4 w-4" />
                Chrome Helper
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-semibold">Parent-assisted</div>
              <p className="mt-1 text-xs text-muted-foreground">Open the provider from a run card and keep sensitive steps under parent control.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CreditCard className="h-4 w-4" />
                Billing & Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-semibold">$9/month</div>
              <p className="mt-1 text-xs text-muted-foreground">Cancel monthly renewal stays visible.</p>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Let SignupAssist do the watching.</CardTitle>
              <CardDescription>
                Find the right signup, set a reminder, and prepare safe fill help before the registration window opens.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Safe. Secure. Parent-controlled.
              </div>
              <Button variant="accent" onClick={() => navigate('/activity-finder')}>
                <Search className="h-4 w-4 mr-2" />
                Find your activity
              </Button>
            </CardContent>
          </Card>
          <BillingCard userId={user?.id} returnPath="/dashboard" />
        </div>

        <div className="mb-8 space-y-8">
          <DashboardRunSection
            title="Ready to prepare"
            description="Draft or ready run packets that need a parent check before the signup window."
            icon={ClipboardCheck}
            runs={dashboardSections.ready}
            emptyCopy="No draft run packets need preparation right now."
            sectionKey="ready"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />

          <DashboardRunSection
            title="Registration opening soon"
            description="Registration windows in the next 72 hours. Keep the provider account and helper ready."
            icon={Clock}
            runs={dashboardSections.openingSoon}
            emptyCopy="No registration windows are opening in the next 72 hours."
            sectionKey="openingSoon"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />

          <DashboardRunSection
            title="Scheduled/ready runs"
            description="Runs prepared for supervised SignupAssist help."
            icon={Play}
            runs={dashboardSections.scheduled}
            emptyCopy="No scheduled supervised runs yet."
            sectionKey="scheduled"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />

          <DashboardRunSection
            title="Paused for parent approval"
            description="Sensitive actions stop here: login, payment, waivers, provider uncertainty, price changes, and final submit."
            icon={PauseCircle}
            runs={dashboardSections.paused}
            emptyCopy="No runs are paused for parent approval."
            sectionKey="paused"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />

          <section aria-labelledby="provider-learning-readiness" className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="provider-learning-readiness" className="flex items-center gap-2 text-xl font-semibold">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Provider learning/readiness
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Provider learning uses redacted signals. Delegated signup is future-only unless readiness and mandate checks pass.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/discovery-runs')}>
                View readiness
              </Button>
            </div>
            {providerReadinessCards.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Provider readiness appears after the first supervised run packet.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {providerReadinessCards.map(({ run, summary, readiness }) => (
                  <Card key={run.provider_key}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">{summary.name}</CardTitle>
                          <CardDescription>{summary.fixtureCoverage.coverageLabel}</CardDescription>
                        </div>
                        <Badge variant={providerReadinessTone(readiness)}>{readiness}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {providerReadinessCopy(readiness)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <DashboardRunSection
            title="Completed signups"
            description="Finished runs and submitted registration records."
            icon={CheckCircle}
            runs={dashboardSections.completed}
            emptyCopy="Completed signups will appear here."
            sectionKey="completed"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />

          <DashboardRunSection
            title="Failed/manual fallback runs"
            description="Runs that need manual fallback, cancellation cleanup, or a fresh provider link."
            icon={XCircle}
            runs={dashboardSections.fallback}
            emptyCopy="No failed or manual fallback runs."
            sectionKey="fallback"
            expandedAuditRunId={expandedAuditRunId}
            onToggleAudit={toggleAuditRun}
            onReview={reviewRun}
            onResume={resumeRun}
            onViewAudit={viewRunAudit}
          />
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{prompts.dashboard.stats.totalPlans}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{plans.length}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{prompts.dashboard.stats.successRate}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.success_rate}%</div>
              <Progress value={stats.success_rate} className="mt-2" />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{prompts.dashboard.stats.completed}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{prompts.dashboard.stats.failed}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>

        {/* Registration Plans */}
        <Card>
          <CardHeader>
            <CardTitle>{prompts.dashboard.plansTitle}</CardTitle>
            <CardDescription>
              {prompts.dashboard.plansDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">{prompts.dashboard.empty.title}</h3>
                <p className="text-muted-foreground mb-4">
                  {prompts.dashboard.empty.description}
                </p>
                <Button onClick={() => navigate('/plan-builder')}>
                  {prompts.dashboard.empty.cta}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {plans.map((plan) => (
                  <div key={plan.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(plan)}
                        <div>
                          <h4 className="font-semibold">{plan.program_ref}</h4>
                          <p className="text-sm text-muted-foreground">
                            {plan.child.name} • Opens {format(new Date(plan.opens_at), 'PPP p')}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <Badge variant={getStatusVariant(plan)}>
                          {getStatusText(plan)}
                        </Badge>
                        
                        {plan.executions.length === 0 && isTestRoutesEnabled() && (
                          <Button
                            size="sm"
                            onClick={() => startSignupJob(plan.id)}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            {prompts.dashboard.actions.start}
                          </Button>
                        )}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/plan/${plan.id}`)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          {prompts.dashboard.actions.view}
                        </Button>
                      </div>
                    </div>
                    
                    {plan.executions.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-muted-foreground">
                          {prompts.dashboard.lastExecution(format(new Date(plan.executions[0].started_at), 'PPP p'))}
                          {plan.executions[0].confirmation_ref && (
                            <span className="ml-2">• {prompts.dashboard.confirmation(plan.executions[0].confirmation_ref)}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <footer className="mt-8 rounded-lg border bg-card p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Parent-controlled privacy and safety
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                SignupAssist minimizes child data, pauses sensitive steps, stores no card numbers, logs every action, and uses only redacted provider-learning signals.
              </p>
            </div>
            <nav aria-label="Legal and security links" className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/terms" target="_blank" rel="noreferrer">Terms</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/safety" target="_blank" rel="noreferrer">Security</a>
              </Button>
            </nav>
          </div>
        </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
