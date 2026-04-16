import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, AlertTriangle, Eye, RefreshCw, Play, Loader2, Zap, ClipboardCheck, CreditCard, ShieldCheck, UserRound, Home, Search, Users, Chrome, Settings, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { showPromptToast, showErrorToast } from '@/lib/toastHelpers';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';
import { prompts } from '@/lib/prompts';
import { BillingCard } from '@/components/BillingCard';

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
  provider_name: string;
  status: string;
  target_program: string | null;
  target_url: string;
  created_at: string;
  caps: unknown;
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
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const firstName = user?.email?.split('@')[0]?.split(/[._-]/)[0] || 'there';
  const greetingName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    } else if (user) {
      loadPlansData();
    }
  }, [user, authLoading, navigate]);

  const loadPlansData = async () => {
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
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('autopilot_runs')
          .select('id, provider_name, status, target_program, target_url, created_at, caps')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('children')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user!.id),
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
  };

  const refreshData = async () => {
    setRefreshing(true);
    await loadPlansData();
    setRefreshing(false);
    showPromptToast('dataRefreshed');
  };

  const startSignupJob = async (planId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('start-signup-job', {
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
              { label: 'Activity Finder', icon: Search, action: () => navigate('/plan-builder') },
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
              <Button variant="accent" onClick={() => navigate('/autopilot')}>
                <Zap className="h-4 w-4 mr-2" />
                Start supervised autopilot
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-primary/20 bg-[hsl(var(--secondary))]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                Upcoming registration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">
                {autopilotRuns[0]?.target_program || 'Keva Sports Center'}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Spots fill fast. Supervised autopilot can watch and help when it opens.
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
              <div className="text-sm font-semibold">Helper is on</div>
              <p className="mt-1 text-xs text-muted-foreground">Paste a run packet and keep the provider tab ready.</p>
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
                Start supervised autopilot and we'll handle the timing and safe filling, so you don't have to stare at the registration page.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Safe. Secure. Parent-controlled.
              </div>
              <Button variant="accent" onClick={() => navigate('/autopilot')}>
                <Zap className="h-4 w-4 mr-2" />
                Start supervised autopilot
              </Button>
            </CardContent>
          </Card>
          <BillingCard userId={user?.id} returnPath="/dashboard" />
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Recent supervised autopilot runs</CardTitle>
            <CardDescription>
              Run packets capture provider, child, target session, caps, and readiness for Chrome helper signup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {autopilotRuns.length === 0 ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">No supervised run packets yet.</p>
                  <p className="text-sm text-muted-foreground">Create one before the next registration window.</p>
                </div>
                <Button variant="accent" onClick={() => navigate('/autopilot')}>
                  <Zap className="h-4 w-4 mr-2" />
                  Create run packet
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {autopilotRuns.map((run) => (
                  <div key={run.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{run.provider_name}</p>
                        <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>{run.status}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {run.target_program || run.target_url}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => navigate('/autopilot')}>
                      Open setup
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
                        
                        {plan.executions.length === 0 && (
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
          </section>
        </div>
      </div>
    </div>
  );
}
