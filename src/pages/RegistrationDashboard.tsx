import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, AlertTriangle, Eye, RefreshCw, Play, Loader2 } from 'lucide-react';
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

export default function RegistrationDashboard() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<ExecutionStats>({
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    success_rate: 0
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

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
      const { data: plansData, error: plansError } = await supabase
        .from('plans')
        .select(`
          *,
          children:child_id (name),
          plan_executions (*)
        `)
        .order('created_at', { ascending: false });

      if (plansError) throw plansError;

      const formattedPlans = plansData?.map(plan => ({
        id: plan.id,
        program_ref: plan.program_ref,
        status: plan.status,
        opens_at: plan.opens_at,
        created_at: plan.created_at,
        child: {
          name: plan.children?.name || 'Unknown Child'
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
    
    if (!latestExecution) return 'Ready to Start';
    if (!latestExecution.finished_at) return 'Running';
    if (latestExecution.confirmation_ref) return 'Completed';
    return 'Failed';
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
          <p className="mt-4 text-muted-foreground">Loading registration data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Registration Dashboard</h1>
              <p className="text-muted-foreground">
                Monitor and manage automated registrations
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                onClick={refreshData}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button onClick={() => navigate('/plan-builder')}>
                Create New Plan
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Plans</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{plans.length}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.success_rate}%</div>
              <Progress value={stats.success_rate} className="mt-2" />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>

        {/* Registration Plans */}
        <Card>
          <CardHeader>
            <CardTitle>Registration Plans</CardTitle>
            <CardDescription>
              Manage your automated registration plans and monitor their status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {plans.length === 0 ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Plans Found</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first registration plan to get started.
                </p>
                <Button onClick={() => navigate('/plan-builder')}>
                  Create Plan
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
                            Start
                          </Button>
                        )}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/plan/${plan.id}`)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                    
                    {plan.executions.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-muted-foreground">
                          Last execution: {format(new Date(plan.executions[0].started_at), 'PPP p')}
                          {plan.executions[0].confirmation_ref && (
                            <span className="ml-2">• Confirmation: {plan.executions[0].confirmation_ref}</span>
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
      </div>
    </div>
  );
}