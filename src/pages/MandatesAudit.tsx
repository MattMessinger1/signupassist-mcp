import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, FileText, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CreateTestMandate } from '@/components/CreateTestMandate';
import { JWSInspector } from '@/components/JWSInspector';
import { MockAuditGenerator } from '@/components/MockAuditGenerator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Mandate {
  id: string;
  provider: string;
  program_ref: string | null;
  scope: string[];
  max_amount_cents: number | null;
  valid_from: string;
  valid_until: string;
  status: string;
  created_at: string;
  jws_compact: string;
}

interface AuditEvent {
  id: string;
  event_type: string;
  tool: string | null;
  decision: string | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
  details: any;
  result: string | null;
}

interface MandateAuditLog {
  id: string;
  user_id: string;
  action: string;
  provider: string | null;
  org_ref: string | null;
  program_ref: string | null;
  credential_id: string | null;
  metadata: any;
  created_at: string;
}

export default function MandatesAudit() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [auditEvents, setAuditEvents] = useState<Record<string, AuditEvent[]>>({});
  const [mandateAuditLogs, setMandateAuditLogs] = useState<MandateAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    fetchMandatesAndAudits();
  }, [user, navigate]);

  const fetchMandatesAndAudits = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch mandates
      const { data: mandatesData, error: mandatesError } = await supabase
        .from('mandates')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (mandatesError) throw mandatesError;

      setMandates(mandatesData || []);

      // Fetch audit events for all mandates
      const mandateIds = mandatesData?.map(m => m.id) || [];
      if (mandateIds.length > 0) {
        const { data: eventsData, error: eventsError } = await supabase
          .from('audit_events')
          .select('*')
          .in('mandate_id', mandateIds)
          .order('created_at', { ascending: false });

        if (eventsError) throw eventsError;

        // Group events by mandate_id
        const grouped = (eventsData || []).reduce((acc, event) => {
          if (!event.mandate_id) return acc;
          if (!acc[event.mandate_id]) acc[event.mandate_id] = [];
          acc[event.mandate_id].push(event);
          return acc;
        }, {} as Record<string, AuditEvent[]>);

        setAuditEvents(grouped);
      }

      // PHASE 4: Fetch mandate_audit logs
      const { data: auditLogsData, error: auditLogsError } = await supabase
        .from('mandate_audit')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (auditLogsError) {
        console.error('Error fetching audit logs:', auditLogsError);
      } else {
        setMandateAuditLogs(auditLogsData || []);
      }
    } catch (err) {
      console.error('Error fetching mandates:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch mandates');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'default';
      case 'expired':
        return 'secondary';
      case 'revoked':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getDecisionColor = (decision: string | null) => {
    switch (decision?.toLowerCase()) {
      case 'allowed':
        return 'default';
      case 'denied':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Mandate Audit Trail</h1>
            <p className="text-muted-foreground">
              View and test mandates and their authorization history
            </p>
          </div>

          <Tabs defaultValue="mandates" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="mandates">Mandates</TabsTrigger>
              <TabsTrigger value="audit-trail">Audit Trail</TabsTrigger>
              <TabsTrigger value="testing">Testing Tools</TabsTrigger>
            </TabsList>

            <TabsContent value="mandates" className="space-y-4 mt-6">

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {mandates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">No mandates found</p>
                <p className="text-sm text-muted-foreground">
                  Mandates will appear here once you create a plan
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {mandates.map((mandate) => (
                <Card key={mandate.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 mb-2">
                          <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            {mandate.provider} Mandate
                          </CardTitle>
                          {/* Tier badge - check metadata for mandate_tier */}
                          {(mandate as any).metadata?.mandate_tier && (
                            <Badge 
                              variant={(mandate as any).metadata.mandate_tier === 'discovery' ? 'secondary' : 'default'}
                            >
                              {(mandate as any).metadata.mandate_tier === 'discovery' 
                                ? '🔍 Discovery' 
                                : '⚡ Execution'}
                            </Badge>
                          )}
                        </div>
                        <CardDescription>
                          {(mandate as any).metadata?.mandate_tier === 'discovery' 
                            ? 'Browse programs and check prerequisites'
                            : mandate.program_ref 
                            ? `Register for ${mandate.program_ref}`
                            : 'Execution mandate'}
                        </CardDescription>
                      </div>
                      <Badge variant={getStatusColor(mandate.status)}>
                        {mandate.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Valid From:</span>
                        <p className="font-medium">
                          {format(new Date(mandate.valid_from), 'PPp')}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Valid Until:</span>
                        <p className="font-medium">
                          {format(new Date(mandate.valid_until), 'PPp')}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Max Amount:</span>
                        <p className="font-medium">
                          ${((mandate.max_amount_cents || 0) / 100).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Scopes:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {mandate.scope.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="jws">
                        <AccordionTrigger className="text-sm">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            View JWS Token
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                            {mandate.jws_compact}
                          </pre>
                        </AccordionContent>
                      </AccordionItem>

                      {auditEvents[mandate.id]?.length > 0 && (
                        <AccordionItem value="audit">
                          <AccordionTrigger className="text-sm">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              Audit Events ({auditEvents[mandate.id].length})
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-2">
                              {auditEvents[mandate.id].map((event) => (
                                <div
                                  key={event.id}
                                  className="border rounded p-3 space-y-2"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">
                                        {event.event_type}
                                      </span>
                                      {event.tool && (
                                        <Badge variant="outline" className="text-xs">
                                          {event.tool}
                                        </Badge>
                                      )}
                                    </div>
                                    {event.decision && (
                                      <Badge
                                        variant={getDecisionColor(event.decision)}
                                        className="text-xs"
                                      >
                                        {event.decision}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {format(new Date(event.created_at), 'PPp')}
                                  </div>
                                  {event.result && (
                                    <div className="text-xs">
                                      <span className="text-muted-foreground">Result:</span>
                                      <pre className="mt-1 bg-muted p-2 rounded overflow-x-auto">
                                        {event.result}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
            </TabsContent>

            <TabsContent value="audit-trail" className="space-y-4 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Production Audit Trail
                  </CardTitle>
                  <CardDescription>
                    Complete log of all actions performed (credentials accessed, registrations, etc.)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {mandateAuditLogs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No audit logs yet. Actions will appear here as you use the system.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {mandateAuditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="border rounded p-3 space-y-2 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {log.action}
                              </Badge>
                              {log.provider && (
                                <span className="text-sm text-muted-foreground">
                                  {log.provider}
                                </span>
                              )}
                              {log.org_ref && (
                                <Badge variant="secondary" className="text-xs">
                                  {log.org_ref}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(log.created_at), 'PPp')}
                            </span>
                          </div>
                          {log.program_ref && (
                            <div className="text-sm">
                              <span className="text-muted-foreground">Program:</span>{' '}
                              {log.program_ref}
                            </div>
                          )}
                          {log.credential_id && (
                            <div className="text-xs text-muted-foreground">
                              Credential ID: {log.credential_id}
                            </div>
                          )}
                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View metadata
                              </summary>
                              <pre className="mt-2 bg-muted p-2 rounded overflow-x-auto">
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="testing" className="space-y-4 mt-6">
              <div className="grid grid-cols-1 gap-6">
                <CreateTestMandate onMandateCreated={fetchMandatesAndAudits} />
                <JWSInspector />
                <MockAuditGenerator 
                  mandates={mandates} 
                  onEventCreated={fetchMandatesAndAudits}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
