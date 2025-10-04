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
import { prompts } from "@/lib/prompts";

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
  const [checkStatus, setCheckStatus] = useState<string>('');
  const [lastCheckTime, setLastCheckTime] = useState<number>(0);
  const { toast } = useToast();

  // Calculate progress metrics (Phase 2.2: Fix progress calculation)
  const progressMetrics = useMemo(() => {
    if (!data) return { total: 5, completed: 0, percentage: 0 };
    
    const checks = [
      data.account,
      data.membership,
      data.payment,
      data.child,
      data.waiver
    ].filter(Boolean); // Only count checks that exist
    
    const completed = checks.filter(c => c?.ok === true).length;
    const total = 5; // Still show total as 5 for UI consistency
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

  const recheck = async (retries = 1) => {
    if (!credentialId) {
      toast({ title: "Select an account", description: "Choose your Blackhawk credential first.", variant: "destructive" });
      return;
    }

    console.log('[PrereqCheck] 🚀 Starting prerequisite check...', { credentialId, orgRef });

    // Check cache (30 second cooldown for testing)
    const now = Date.now();
    if (now - lastCheckTime < 30000) {
      console.log('[PrereqCheck] ⏸️ Skipping - recently checked (cache cooldown)');
      toast({ description: 'Prerequisites recently checked. Please wait 30 seconds before rechecking.' });
      return;
    }

    setLoading(true);
    setCheckStatus('Verifying session...');
    
    // Retry logic
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Step 1: Session verification with detailed logging
        console.log('[PrereqCheck] 📝 Step 1: Getting session...');
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[PrereqCheck] ❌ Session error:', sessionError);
          throw new Error(`Session error: ${sessionError.message}`);
        }
        
        if (!session) {
          console.error('[PrereqCheck] ❌ No session found');
          throw new Error('Please log in again - your session has expired');
        }
        
        console.log('[PrereqCheck] ✅ Session valid, user:', session.user.email, 'token:', session.access_token.substring(0, 20) + '...');

        toast({ title: "Checking prerequisites…", description: prompts.ui.signin.helpers.purpose('Blackhawk') });
        
        setCheckStatus('Connecting to browser...');
        
        // Step 2: Prepare the edge function call
        console.log('[PrereqCheck] 📡 Step 2: Preparing mcp-executor call...', {
          tool: 'scp:check_prerequisites',
          org_ref: orgRef,
          credential_id: credentialId,
          has_token: !!session.access_token
        });
        
        // Step 3: Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            console.error('[PrereqCheck] ⏱️ Request timed out after 30 seconds');
            reject(new Error('Check timed out after 30 seconds'));
          }, 30000);
        });
        
        // Step 4: Create invoke promise with explicit logging
        const invokePromise = supabase.functions.invoke('mcp-executor', {
          body: {
            tool: 'scp:check_prerequisites',
            args: { 
              org_ref: orgRef, 
              credential_id: credentialId,
              user_jwt: session.access_token
            }
          }
        }).then(result => {
          console.log('[PrereqCheck] ✅ Edge function returned:', result);
          return result;
        }).catch(err => {
          console.error('[PrereqCheck] ❌ Invoke failed:', err);
          throw new Error(`Network error: ${err.message || 'Failed to reach edge function'}`);
        });
        
        console.log('[PrereqCheck] ⏳ Step 3: Waiting for response (30s timeout)...');
        
        const result = await Promise.race([invokePromise, timeoutPromise]) as any;
        
        console.log('[PrereqCheck] 📦 Received result:', { hasData: !!result.data, hasError: !!result.error });
        
        const { data, error } = result;
        
        if (error) {
          console.error('[PrereqCheck] ❌ Edge function returned error:', error);
          throw error;
        }
        
        setCheckStatus('Checking account status...');
        
        // Validate response structure
        if (!data || typeof data !== 'object') {
          console.warn('[PrereqCheck] ⚠️ Malformed response:', data);
          toast({ title: 'Error', description: 'Received incomplete prerequisite data', variant: 'destructive' });
          return;
        }
        
        // Validate we got at least some basic data
        if (!data.account && !data.membership) {
          console.warn('[PrereqCheck] ⚠️ No prerequisite data returned:', data);
          toast({ title: 'Error', description: 'No prerequisite data returned', variant: 'destructive' });
          return;
        }

        console.log('[PrereqCheck] ✅ Valid prerequisite data received');
        setData(data);
        
        // Auto-select single child
        if (data?.children?.length === 1 && !childName) {
          console.log('[PrereqCheck] 👶 Auto-selecting single child:', data.children[0].name);
          setChildName(data.children[0].name);
          onChildSelected?.(data.children[0].name);
        }
        
        // Validate child selection after recheck
        if (childName && data?.children) {
          const stillExists = data.children.some((c: any) => c.name === childName);
          if (!stillExists) {
            console.warn('[PrereqCheck] ⚠️ Previously selected child no longer found');
            setChildName('');
            toast({ title: 'Notice', description: 'Please select a child again', variant: 'default' });
          }
        }

        setCheckStatus('Complete');
        setLastCheckTime(Date.now());

        console.log('[PrereqCheck] 🎉 Check complete, login_status:', data?.login_status);

        if (data?.login_status === 'success') toast({ description: prompts.ui.toasts.prereqsOk });
        if (data?.login_status === 'failed') toast({ title: 'Login failed', description: prompts.ui.signin.errors.badLogin, variant: 'destructive' });
        
        // Success - break retry loop
        break;
        
      } catch (e: any) {
        console.error(`[PrereqCheck] ❌ Fatal error (attempt ${attempt + 1}/${retries + 1}):`, e);
        console.error('[PrereqCheck] Error stack:', e.stack);
        
        // Retry logic for timeouts
        if (attempt < retries && e.message?.includes('timeout')) {
          console.log(`[PrereqCheck] 🔄 Retrying after timeout... (${attempt + 1}/${retries})`);
          setCheckStatus(`Retrying (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        
        // Final failure
        toast({ 
          title: 'Prerequisite Check Failed', 
          description: e?.message || 'Unable to check prerequisites. Please try browsing programs first.', 
          variant: 'destructive' 
        });
        break;
        
      } finally {
        if (attempt === retries) {
          setLoading(false);
          setTimeout(() => setCheckStatus(''), 2000);
        }
      }
    }
  };

  const Row = ({ title, sub, result, href }: { title: string; sub: string; result?: CheckResult; href: string }) => {
    // Handle three states: not checked (null), unknown (ok=null but has reason), pass (ok=true), fail (ok=false)
    const isUnknown = result && result.ok === null && result.reason;
    const isPassing = result?.ok === true;
    const badge = !result
      ? <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> {prompts.prereqs.status.notChecked}</Badge>
      : isUnknown
        ? <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700 bg-amber-50"><Clock className="h-3 w-3" /> {prompts.prereqs.status.unknown}</Badge>
        : result.ok === true
          ? <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" /> {prompts.prereqs.status.complete}</Badge>
          : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {prompts.prereqs.status.actionNeeded}</Badge>;

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
                  {prompts.prereqs.manualVerify}
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
                {prompts.prereqs.openPortal} <ExternalLink className="h-3 w-3" />
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
            <h2 className="text-xl font-semibold mb-1">{prompts.prereqs.title}</h2>
            <p className="text-sm text-muted-foreground">
              {prompts.prereqs.description}
            </p>
          </div>
          <Button 
            type="button" 
            onClick={() => recheck()} 
            disabled={loading} 
            size="sm"
            variant="outline"
            className="gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            {prompts.prereqs.recheck}
          </Button>
        </div>

        {/* Progress Bar */}
        {data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {prompts.prereqs.progress(progressMetrics.completed, progressMetrics.total)}
              </span>
              <span className="text-muted-foreground">{progressMetrics.percentage}%</span>
            </div>
            <Progress value={progressMetrics.percentage} className="h-2" />
            
            {/* Phase 2.1: Progress feedback */}
            {checkStatus && (
              <div className="text-sm text-muted-foreground animate-pulse">
                {checkStatus}
              </div>
            )}
          </div>
        )}

        {/* One-Time Setup Message */}
        {!allComplete && data && (
          <Alert className="border-blue-200 bg-blue-50">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800">
              {prompts.prereqs.oneTimeSetup}
            </AlertDescription>
          </Alert>
        )}

        {/* All Complete Message */}
        {allComplete && (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-sm text-emerald-800 font-medium">
              {prompts.prereqs.allComplete}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Requirement Cards */}
      <div className="space-y-3">
        <Row
          title={prompts.prereqs.checks.account.title}
          sub={prompts.prereqs.checks.account.description(orgRef)}
          result={data?.account}
          href={links.dashboard}
        />
        <Row
          title={prompts.prereqs.checks.membership.title}
          sub={prompts.prereqs.checks.membership.description}
          result={data?.membership}
          href={links.membership}
        />
        <Row
          title={prompts.prereqs.checks.payment.title}
          sub={prompts.prereqs.checks.payment.description}
          result={data?.payment}
          href={links.payment}
        />
        <Row
          title={prompts.prereqs.checks.waiver.title}
          sub={prompts.prereqs.checks.waiver.description}
          result={data?.waiver}
          href={data?.requirements?.find(r => r.id === 'waiver.signed')?.remediation?.url || `${baseUrl}/waivers`}
        />
        <Row
          title={prompts.prereqs.checks.child.title}
          sub={prompts.prereqs.checks.child.description}
          result={data?.child}
          href={links.family}
        />
      </div>

      {/* Child Selection */}
      {data?.children && data.children.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{prompts.prereqs.child.label}</CardTitle>
            <CardDescription className="text-xs">{prompts.prereqs.child.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={childName} onValueChange={(v) => { setChildName(v); onChildSelected?.(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={prompts.prereqs.child.placeholder} />
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
