import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Loader2, AlertTriangle, ArrowRight, Eye, Calendar, DollarSign, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface PlanExecutionStatusProps {
  planId: string;
  mandateId: string;
  programTitle: string;
  childName: string;
  opensAt: string;
  maxAmountCents: number;
}

interface ExecutionLog {
  id: string;
  stage: string;
  status: string;
  error_message?: string;
  created_at: string;
  metadata?: any;
}

interface PlanExecution {
  id: string;
  started_at: string;
  finished_at?: string;
  result?: string;
  confirmation_ref?: string;
  amount_cents?: number;
}

export function PlanExecutionStatus({
  planId,
  mandateId,
  programTitle,
  childName,
  opensAt,
  maxAmountCents,
}: PlanExecutionStatusProps) {
  const navigate = useNavigate();
  const [execution, setExecution] = useState<PlanExecution | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch initial execution data
  useEffect(() => {
    const fetchExecutionData = async () => {
      setLoading(true);
      
      // Get plan execution
      const { data: execData, error: execError } = await supabase
        .from('plan_executions')
        .select('*')
        .eq('plan_id', planId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (execError) {
        console.error('Error fetching execution:', execError);
      } else if (execData) {
        setExecution(execData);
      }

      // Get execution logs
      const { data: logsData, error: logsError } = await supabase
        .from('execution_logs')
        .select('*')
        .eq('plan_id', planId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (logsError) {
        console.error('Error fetching logs:', logsError);
      } else {
        setLogs(logsData || []);
      }

      setLoading(false);
    };

    fetchExecutionData();
  }, [planId]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel(`plan-${planId}-updates`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'plan_executions',
          filter: `plan_id=eq.${planId}`,
        },
        (payload) => {
          console.log('Execution update:', payload);
          if (payload.new) {
            setExecution(payload.new as PlanExecution);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'execution_logs',
          filter: `plan_id=eq.${planId}`,
        },
        (payload) => {
          console.log('New execution log:', payload);
          if (payload.new) {
            setLogs((prev) => [payload.new as ExecutionLog, ...prev].slice(0, 10));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [planId]);

  const getStatusInfo = () => {
    if (!execution) {
      return {
        icon: <Calendar className="h-6 w-6 text-blue-600" />,
        title: 'Plan Scheduled',
        description: `Your registration will begin automatically at the scheduled time`,
        variant: 'default' as const,
      };
    }

    if (execution.finished_at && execution.result === 'success') {
      return {
        icon: <CheckCircle className="h-6 w-6 text-green-600" />,
        title: 'Registration Complete!',
        description: execution.confirmation_ref
          ? `Confirmation: ${execution.confirmation_ref}`
          : 'Registration completed successfully',
        variant: 'default' as const,
      };
    }

    if (execution.finished_at && execution.result === 'failed') {
      return {
        icon: <AlertTriangle className="h-6 w-6 text-destructive" />,
        title: 'Registration Failed',
        description: 'Please check the execution logs for details',
        variant: 'destructive' as const,
      };
    }

    if (execution.started_at && !execution.finished_at) {
      return {
        icon: <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />,
        title: 'Registration In Progress',
        description: 'Your registration is being processed...',
        variant: 'default' as const,
      };
    }

    return {
      icon: <Calendar className="h-6 w-6 text-blue-600" />,
      title: 'Plan Scheduled',
      description: 'Waiting for registration time',
      variant: 'default' as const,
    };
  };

  const statusInfo = getStatusInfo();
  const openDate = new Date(opensAt);
  const isScheduledForFuture = openDate > new Date();

  return (
    <div className="space-y-6">
      {/* Main Status Card */}
      <Card className="border-2">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="mt-1">{statusInfo.icon}</div>
              <div>
                <CardTitle className="text-2xl mb-2">{statusInfo.title}</CardTitle>
                <CardDescription className="text-base">{statusInfo.description}</CardDescription>
              </div>
            </div>
            <Badge variant={statusInfo.variant}>
              {execution?.result || (isScheduledForFuture ? 'Scheduled' : 'Pending')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Plan Details Grid */}
          <div className="grid md:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Program</div>
              <div className="font-medium">{programTitle}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Participant</div>
              <div className="font-medium">{childName}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Registration Opens</div>
              <div className="font-medium">
                {openDate.toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">Payment Limit</div>
              <div className="font-medium">${(maxAmountCents / 100).toFixed(2)}</div>
            </div>
          </div>

          {/* Execution Amount if completed */}
          {execution?.amount_cents && (
            <Alert>
              <DollarSign className="h-4 w-4" />
              <AlertDescription>
                Amount charged: <strong>${(execution.amount_cents / 100).toFixed(2)}</strong>
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4">
            <Button
              onClick={() => navigate('/')}
              variant="outline"
              className="flex-1 min-w-[200px]"
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
            
            <Button
              onClick={() => navigate(`/plans/${planId}`)}
              variant="default"
              className="flex-1 min-w-[200px]"
            >
              <Eye className="mr-2 h-4 w-4" />
              View Full Details
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Mandate Protection Notice */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Protected by Mandate</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              ✅ This registration is protected by mandate <code className="text-xs bg-muted px-1 py-0.5 rounded">{mandateId.slice(0, 8)}...</code>
            </p>
            <p>✅ All actions are logged in a tamper-proof audit trail</p>
            <p>✅ Payment is capped at your specified limit</p>
            <p>✅ You'll be notified at each step of the process</p>
          </div>
        </CardContent>
      </Card>

      {/* Recent Execution Logs */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest execution logs for this plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    log.status === 'success'
                      ? 'bg-green-50 border-green-200'
                      : log.status === 'failed'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-muted/50'
                  }`}
                >
                  <div className="mt-0.5">
                    {log.status === 'success' ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : log.status === 'failed' ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {log.stage}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {log.error_message && (
                      <p className="text-sm">{log.error_message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* What Happens Next */}
      {isScheduledForFuture && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What Happens Next?</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 list-decimal list-inside text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Before Registration Opens:</strong> We'll verify your credentials and
                ensure everything is ready
              </li>
              <li>
                <strong className="text-foreground">At Registration Time:</strong> Our system will automatically log in
                and submit your registration
              </li>
              <li>
                <strong className="text-foreground">Payment Processing:</strong> If registration succeeds, payment will
                be processed per your mandate
              </li>
              <li>
                <strong className="text-foreground">Confirmation:</strong> You'll receive immediate notification with your
                confirmation number
              </li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
