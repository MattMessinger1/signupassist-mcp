import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Clock, RotateCw, ExternalLink, Info, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CheckResult = { ok: boolean | null; summary?: string; reason?: string };
type PrereqPayload = {
  login_status?: "success" | "failed";
  account: CheckResult;
  membership: CheckResult;
  payment: CheckResult;
  child: CheckResult;
  waiver?: CheckResult;
  children?: Array<{ name: string }>;
  requirements?: Array<{ id: string; remediation?: { url?: string } }>;
};

interface Props {
  orgRef: string;
  credentialId: string | null;
  selectedChildName?: string;
  onChildSelected?: (name: string) => void;
  onReadyToContinue?: (ok: boolean) => void;
}

export default function PrerequisitesPanel({ orgRef, credentialId, selectedChildName, onChildSelected, onReadyToContinue }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PrereqPayload | null>(null);
  const [childName, setChildName] = useState<string>(selectedChildName || "");
  const { toast } = useToast();

  // Calculate progress metrics
  const progressMetrics = useMemo(() => {
    if (!data) return { total: 5, completed: 0, percentage: 0 };
    
    const checks = [data.account, data.membership, data.payment, data.child, data.waiver];
    const completed = checks.filter(c => c?.ok === true).length;
    const total = checks.length;
    const percentage = Math.round((completed / total) * 100);
    
    return { total, completed, percentage };
  }, [data]);

  useEffect(() => {
    // All core checks must pass (ok === true) and no unknowns blocking
    const coreChecks = data ? [data.account, data.membership, data.payment, data.child, data.waiver] : [];
    const allPass = !!data && coreChecks.every(r => r?.ok === true) && !!childName;
    const hasUnknown = coreChecks.some(r => r && r.ok === null && r.reason);
    
    // Block if any unknown states (they need manual verification)
    onReadyToContinue?.(allPass && !hasUnknown);
  }, [data, childName, onReadyToContinue]);

  const baseUrl = useMemo(() => `https://${orgRef}.skiclubpro.team`, [orgRef]);

  const links = useMemo(() => {
    const base = `https://${orgRef}.skiclubpro.team`;
    return {
      dashboard: `${base}/dashboard`,
      membership: `${base}/membership`,
      payment: `${base}/user/payment-methods`,
      family: `${base}/user/family`,
    };
  }, [orgRef]);

  const recheck = async () => {
    if (!credentialId) {
      toast({ title: "Select an account", description: "Choose your Blackhawk credential first.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      toast({ title: "Checking prerequisites…", description: "We'll sign in briefly to verify membership, payment, and child profiles." });

      const { data, error } = await supabase.functions.invoke('mcp-executor', {
        body: {
          tool: 'scp:check_prerequisites',
          args: { org_ref: orgRef, credential_id: credentialId, user_jwt: session.access_token }
        }
      });
      if (error) throw error;

      setData(data);
      if (data?.children?.length === 1 && !childName) {
        setChildName(data.children[0].name);
        onChildSelected?.(data.children[0].name);
      }

      if (data?.login_status === 'success') toast({ title: 'Connected to Blackhawk', description: 'Login verified.' });
      if (data?.login_status === 'failed') toast({ title: 'Login failed', description: 'Please recheck your credentials.', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Prereq check failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const Row = ({ title, sub, result, href }: { title: string; sub: string; result?: CheckResult; href: string }) => {
    // Handle three states: not checked (null), unknown (ok=null but has reason), pass (ok=true), fail (ok=false)
    const isUnknown = result && result.ok === null && result.reason;
    const isPassing = result?.ok === true;
    const badge = !result
      ? <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Not checked</Badge>
      : isUnknown
        ? <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700 bg-amber-50"><Clock className="h-3 w-3" /> Unknown</Badge>
        : result.ok === true
          ? <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Complete</Badge>
          : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Action Needed</Badge>;

    const showAction = !result || result.ok !== true; // Show action for not-checked, unknown, or fail

    return (
      <Card className={isUnknown ? "border-amber-200" : isPassing ? "border-emerald-200 bg-emerald-50/30" : undefined}>
        <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <CardDescription className="text-xs mt-1">{sub}</CardDescription>
          </div>
          {badge}
        </CardHeader>
        {(result?.summary || result?.reason || showAction) && (
          <CardContent className="pt-0 space-y-2">
            {result?.summary && !isPassing && <div className="text-xs text-muted-foreground">{result.summary}</div>}
            {result?.reason && <div className="text-xs text-muted-foreground italic">{result.reason}</div>}
            {isUnknown && (
              <Alert className="border-amber-200 bg-amber-50">
                <Info className="h-3 w-3 text-amber-600" />
                <AlertDescription className="text-xs text-amber-800">
                  Please verify this manually on the club's website.
                </AlertDescription>
              </Alert>
            )}
            {showAction && (
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                className="gap-2 h-8 text-xs" 
                onClick={() => window.open(href, '_blank')}
              >
                Open in Club Portal <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    );
  };

  const allComplete = progressMetrics.completed === progressMetrics.total && !!childName;

  return (
    <div className="space-y-6" aria-label="Account prerequisites">
      {/* Header with Progress */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-semibold mb-1">Account Prerequisites</h2>
            <p className="text-sm text-muted-foreground">
              Verify your account meets requirements for automated registration
            </p>
          </div>
          <Button 
            type="button" 
            onClick={recheck} 
            disabled={loading} 
            size="sm"
            variant="outline"
            className="gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Recheck
          </Button>
        </div>

        {/* Progress Bar */}
        {data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {progressMetrics.completed} of {progressMetrics.total} requirements complete
              </span>
              <span className="text-muted-foreground">{progressMetrics.percentage}%</span>
            </div>
            <Progress value={progressMetrics.percentage} className="h-2" />
          </div>
        )}

        {/* One-Time Setup Message */}
        {!allComplete && data && (
          <Alert className="border-blue-200 bg-blue-50">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800">
              <strong>One-time setup:</strong> These requirements (membership, payment method, waivers) are typically 
              completed once. After setup, future registrations will be much faster!
            </AlertDescription>
          </Alert>
        )}

        {/* All Complete Message */}
        {allComplete && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-sm text-emerald-800 font-medium">
              ✨ All prerequisites complete! You're ready to proceed with registration.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Requirement Cards */}
      <div className="space-y-3">
        <Row
          title="Account Login"
          sub="Can we access your Blackhawk account dashboard?"
          result={data?.account}
          href={links.dashboard}
        />
        <Row
          title="Active Membership"
          sub="Required for most programs (typically renewed annually)"
          result={data?.membership}
          href={links.membership}
        />
        <Row
          title="Payment Method"
          sub="Card or bank account saved in club's billing portal"
          result={data?.payment}
          href={links.payment}
        />
        <Row
          title="Seasonal Waiver"
          sub="Liability waiver (often bundled with membership)"
          result={data?.waiver}
          href={data?.requirements?.find(r => r.id === 'waiver.signed')?.remediation?.url || `${baseUrl}/waivers`}
        />
        <Row
          title="Child Profile"
          sub="At least one child must be added to your account"
          result={data?.child}
          href={links.family}
        />
      </div>

      {/* Child Selection */}
      {data?.children && data.children.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Select Child for Registration</CardTitle>
            <CardDescription className="text-xs">Choose which child to register for this program</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={childName} onValueChange={(v) => { setChildName(v); onChildSelected?.(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a child" />
              </SelectTrigger>
              <SelectContent>
                {data.children.map((c, i) => (
                  <SelectItem key={`${i}-${c.name}`} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
