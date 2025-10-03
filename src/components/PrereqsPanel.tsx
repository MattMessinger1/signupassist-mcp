import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, RotateCw, ExternalLink } from "lucide-react";
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

  useEffect(() => {
    const allPass = !!data && [data.account, data.membership, data.payment, data.child].every(r => r.ok === true) && !!childName;
    onReadyToContinue?.(allPass);
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
    const badge = !result || result.ok === null
      ? <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Not checked</Badge>
      : result.ok
        ? <Badge className="bg-emerald-100 text-emerald-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Pass</Badge>
        : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Fail</Badge>;

    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{sub}</CardDescription>
          </div>
          {badge}
        </CardHeader>
        <CardContent className="space-y-3">
          {result?.summary && <div className="text-sm">{result.summary}</div>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={() => window.open(href, '_blank')}>
              Open in Blackhawk <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4" aria-label="Account prerequisites">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Account Prerequisites</h2>
          <p className="text-sm text-muted-foreground">We verify you can sign in and have what Blackhawk requires before registration.</p>
        </div>
        <Button type="button" onClick={recheck} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          Recheck
        </Button>
      </div>

      <Row
        title="Account Status"
        sub="Can we sign in to Blackhawk (SkiClubPro) and reach your dashboard?"
        result={data?.account}
        href={links.dashboard}
      />
      <Row
        title="Membership Status"
        sub="Do you have an active Blackhawk membership for this season? Required for most registrations."
        result={data?.membership}
        href={links.membership}
      />
      <Row
        title="Payment Method"
        sub="Is a chargeable card/bank method available via Blackhawk's billing portal?"
        result={data?.payment}
        href={links.payment}
      />
      <Row
        title="Child Profile"
        sub="We'll use this child during registration. Add one if needed, then pick here."
        result={data?.child}
        href={links.family}
      />
      <Row
        title="Required Waivers"
        sub="Most clubs require you to sign a seasonal waiver. Sometimes this is part of membership or program signup."
        result={data?.waiver}
        href={data?.requirements?.find(r => r.id === 'waiver.signed')?.remediation?.url || `${baseUrl}/waivers`}
      />

      {data?.children && data.children.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Choose Child for This Plan</CardTitle>
            <CardDescription>We'll use this child during registration.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={childName} onValueChange={(v) => { setChildName(v); onChildSelected?.(v); }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a child" /></SelectTrigger>
              <SelectContent>
                {data.children.map((c, i) => <SelectItem key={`${i}-${c.name}`} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
