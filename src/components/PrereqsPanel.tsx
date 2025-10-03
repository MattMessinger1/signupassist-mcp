import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Clock, RotateCw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type CheckResult = {
  ok: boolean | null;                 // true = pass, false = fail, null = unknown
  summary?: string;                   // e.g. "Logged in as Matt"
  reason?: string;                    // brief failure reason
  confidence?: "high" | "medium" | "low";
  lastCheckedAt?: string;             // ISO string
  evidenceSnippet?: string;           // small text sample for debugging
};

type PrereqPayload = {
  login_status?: "success" | "failed";
  account: CheckResult;
  membership: CheckResult;
  payment: CheckResult;
  child: CheckResult;
};

interface Props {
  orgRef: string;                // e.g., "blackhawk-ski-club"
  credentialId: string | null;   // user's SkiClubPro cred id
  childName?: string;            // optional: for child check
  onReadyToContinue?: (allPass: boolean) => void;
  onChildSelected?: (childName: string) => void;
  sessionToken?: string | null;
  onSessionToken?: (token: string | null) => void;
}

export default function PrerequisitesPanel({ orgRef, credentialId, childName, onReadyToContinue, onChildSelected, sessionToken, onSessionToken }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PrereqPayload | null>(null);
  const [children, setChildren] = useState<Array<{ id?: string; name: string }>>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const { toast } = useToast();

  const links = useMemo(() => {
    const base = `https://${orgRef}.skiclubpro.team`;
    return {
      account: `${base}/user`,
      membership: `${base}/membership`,
      payment: `${base}/user/payment-methods`,
      family: `${base}/user/family`,
      dashboard: `${base}/dashboard`,
    };
  }, [orgRef]);

  const allPass = !!data && [data.account, data.membership, data.payment, data.child].every(r => r.ok === true);

  useEffect(() => {
    onReadyToContinue?.(allPass);
  }, [allPass, onReadyToContinue]);

  const recheck = async (forceLogin = true) => {
    if (!credentialId) {
      toast({
        title: "Credentials required",
        description: "Add your Blackhawk (SkiClubPro) login in Settings first.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      toast({ title: "Connecting to Blackhawk…", description: "Launching browser session and verifying your account…" });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      // Build args for prerequisites check
      const args: any = {
        org_ref: orgRef,
        credential_id: credentialId,
        user_jwt: session.access_token,
        child_name: childName || undefined,
        force_login: forceLogin
      };

      // Include session token if available (for immediate chaining)
      if (sessionToken) {
        args.session_token = sessionToken;
      }

      const { data, error } = await supabase.functions.invoke("mcp-executor", {
        body: {
          tool: "scp:check_prerequisites",
          args
        }
      });
      if (error) throw error;

      // Store session token for optional reuse
      if (data?.session_token && onSessionToken) {
        onSessionToken(data.session_token);
      } else if (onSessionToken) {
        onSessionToken(null);
      }

      const payload: PrereqPayload = data?.prereqs || data;
      setData(payload);
      
      // Hydrate children list from response
      const discoveredChildren = (data as any)?.children || [];
      setChildren(discoveredChildren);
      
      // If only 1 child, default-select it
      if (discoveredChildren.length === 1) {
        const only = discoveredChildren[0];
        setSelectedChild(only.name);
        onChildSelected?.(only.name);
      }

      if (payload?.login_status === "success") {
        toast({ title: "Connected to Blackhawk", description: "Account verified successfully." });
      } else if (payload?.login_status === "failed") {
        toast({
          title: "Login failed",
          description: "Could not sign in to Blackhawk. Please check your password in Settings.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err?.message ?? "Could not complete checks.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const Row = ({
    title,
    sub,
    result,
    actionHref,
    actionLabel
  }: {
    title: string;
    sub: string;
    result: CheckResult | null | undefined;
    actionHref: string;
    actionLabel: string;
  }) => {
    let badge: React.ReactElement;
    if (!result || result.ok === null) {
      badge = (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" /> Not checked
        </Badge>
      );
    } else if (result.ok) {
      badge = (
        <Badge className="bg-emerald-100 text-emerald-800 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Pass
        </Badge>
      );
    } else {
      badge = (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Fail
        </Badge>
      );
    }

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
          {result?.summary && (
            <div className="text-sm">
              <span className="font-medium">Result:&nbsp;</span>
              <span>{result.summary}</span>
              {result.confidence && <span className="ml-2 text-xs text-muted-foreground">({result.confidence} confidence)</span>}
            </div>
          )}
          {result?.reason && (
            <Alert>
              <AlertDescription className="text-sm">{result.reason}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => window.open(actionHref, "_blank")}
            >
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
          <p className="text-sm text-muted-foreground">
            We verify you can sign in and have what Blackhawk requires before registration.
          </p>
        </div>
        <Button type="button" onClick={() => recheck(true)} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          Recheck
        </Button>
      </div>

      <Row
        title="Account Status"
        sub="Can we sign in to Blackhawk (SkiClubPro) with your saved credentials and reach the dashboard?"
        result={data?.account}
        actionHref={links.dashboard}
        actionLabel="Open Dashboard"
      />

      <Row
        title="Membership Status"
        sub="Do you have an active Blackhawk membership for the current season? Required for most program registrations."
        result={data?.membership}
        actionHref={links.membership}
        actionLabel="Manage Membership"
      />

      <Row
        title="Payment Method"
        sub="Is there a chargeable card or bank account available via Blackhawk's Stripe portal? Needed to pay automatically."
        result={data?.payment}
        actionHref={links.payment}
        actionLabel="Manage Payment"
      />

      <Row
        title="Child Profile"
        sub="Do you have a child profile in Blackhawk? If not, add one. If you have multiple, choose which child to use for this plan."
        result={data?.child}
        actionHref={links.family}
        actionLabel="Manage Family"
      />

      {children && children.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Choose Child for This Plan</CardTitle>
            <CardDescription>We'll use this child during checkout. You can change it later.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select value={selectedChild} onValueChange={(v) => { setSelectedChild(v); onChildSelected?.(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a child" />
              </SelectTrigger>
              <SelectContent>
                {children.map((c, idx) => (
                  <SelectItem key={`${c.id || idx}-${c.name}`} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => selectedChild && onReadyToContinue?.(true)}
                disabled={!selectedChild}
              >
                Use Selected Child
              </Button>
              <Button type="button" variant="outline" onClick={() => recheck(false)}>Refresh list</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {allPass && (
        <Alert>
          <AlertDescription>All prerequisites passed. You can proceed.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}