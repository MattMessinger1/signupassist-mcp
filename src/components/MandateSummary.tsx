import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithDiag } from '@/lib/invokeWithDiag';
import { Loader2, Info, ChevronDown, ChevronUp } from 'lucide-react';
import ReminderPreferences, { ReminderPrefs } from './ReminderPreferences';
import { prompts, fmt } from '@/lib/prompts';

type Caps = { max_provider_charge_cents: number | null; service_fee_cents: number | null };

interface Props {
  orgRef: string;                    // e.g. 'blackhawk-ski-club'
  programTitle: string;
  programRef: string;
  credentialId: string;
  childId: string;                   // Child database ID
  childName: string;                 // Child name for display
  answers: Record<string, unknown>;
  detectedPriceCents: number | null;
  caps: Caps;
  openTimeISO: string;               // ISO datetime when registration opens
  preferredSlot: string;             // human-friendly slot description
  onCreated: (planId: string, mandateId: string) => void;
  mandateConsents?: boolean[];       // External consent state from parent form
  onMandateConsentsChange?: (consents: boolean[]) => void; // Callback to update parent form
}

export default function MandateSummary({
  orgRef, programTitle, programRef, credentialId, childId, childName, answers,
  detectedPriceCents, caps, openTimeISO, preferredSlot, onCreated,
  mandateConsents, onMandateConsentsChange
}: Props) {
  const { toast } = useToast();
  const [internalConsents, setInternalConsents] = useState<boolean[]>([false, false, false, false, false, false]);
  
  // Sync parent consents to internal state when provided
  useEffect(() => {
    if (Array.isArray(mandateConsents) && mandateConsents.length === 6) {
      setInternalConsents(mandateConsents);
    }
  }, [mandateConsents]);
  
  // Use external consents if provided, otherwise use internal state
  const consents = mandateConsents || internalConsents;
  const updateConsents = (newConsents: boolean[]) => {
    if (onMandateConsentsChange) {
      onMandateConsentsChange(newConsents);
    } else {
      setInternalConsents(newConsents);
    }
  };
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMandateJSON, setShowMandateJSON] = useState(false);
  const [reminders, setReminders] = useState<ReminderPrefs>({
    channels: { email: true, sms: false },
    offsets_sec: [86400, 3600] // 24h and 1h defaults
  });

  const fmtUSD = (cents: number | null) =>
    cents == null ? '—' : `$${(cents / 100).toFixed(2)} USD`;

  const scopeList = useMemo(() => ([
    { key: 'scp:login', label: 'Sign in to Blackhawk (SkiClubPro) on your behalf' },
    { key: 'scp:enroll', label: 'Fill and submit the program registration form' },
    { key: 'scp:write:register', label: 'Click buttons/links required to complete registration' },
    { key: 'scp:pay', label: `Pay the provider up to your cap (${fmtUSD(caps.max_provider_charge_cents)})` },
    { key: 'signupassist:fee', label: `Charge a ${fmtUSD(caps.service_fee_cents)} success fee only if we get the spot` },
  ]), [caps]);

  const mandateJSON = useMemo(() => ({
    scopes: scopeList.map(s => s.key),
    caps: {
      max_provider_charge_cents: caps.max_provider_charge_cents,
      service_fee_cents: caps.service_fee_cents
    },
    program_ref: programRef,
    child_name: childName,
    opens_at: openTimeISO,
    credential_id: credentialId
  }), [scopeList, caps, programRef, childName, openTimeISO, credentialId]);

  const consentItems = useMemo(
    () => prompts.ui.review.consent(fmt.money(caps.max_provider_charge_cents || 0), orgRef),
    [caps.max_provider_charge_cents, orgRef]
  );

  const valid = useMemo(() => {
    const reasons: string[] = [];
    const allConsents = Array.isArray(consents) && consents.length === 6 && consents.every(Boolean);
    if (!allConsents) reasons.push('consents incomplete');
    if (!childName) reasons.push('childName missing');
    if (!programRef) reasons.push('programRef missing');
    if (!credentialId) reasons.push('credentialId missing');
    if (!openTimeISO) reasons.push('openTimeISO missing');

    const enabled = reasons.length === 0;
    console.log('[MandateSummary] valid gate', {
      consents,
      allConsents,
      childName: !!childName,
      programRef: !!programRef,
      credentialId: !!credentialId,
      openTimeISO: !!openTimeISO,
      enabled,
      reasons,
    });
    return enabled;
  }, [consents, childName, programRef, credentialId, openTimeISO]);

  const createPlanAndMandate = async () => {
    console.log('[MandateSummary] 🟢 createPlanAndMandate triggered');
    if (!valid) {
      toast({ title: 'Missing consent or fields', description: 'Please review and accept the terms above.', variant: 'destructive' });
      return;
    }
    
    setSubmitting(true);
    try {
      console.log('[MandateSummary] 🧭 entering try block');
      // guards
      if (!programRef) throw new Error('programRef missing');
      if (!childId) throw new Error('childId missing');
      if (!openTimeISO) throw new Error('openTimeISO missing');

      // 1️⃣  Create mandate
      console.log('[MandateSummary] 🚀 Preparing to call mandate-issue', {
        provider: 'skiclubpro',
        program_ref: programRef,
        child_id: childId,
        openTimeISO,
      });
      
      // 🔍 Dynamically look up stored credential for this user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: creds, error: credErr } = await supabase
        .from('stored_credentials')
        .select('id')
        .eq('user_id', user.id)
        .eq('provider', 'skiclubpro')
        .maybeSingle(); // safe but still strict
      console.log('[MandateSummary] credential lookup result', creds);
      if (credErr) {
        console.error('[MandateSummary] credential lookup failed', credErr);
        throw new Error('Credential lookup failed');
      }
      if (!creds) throw new Error('No stored credential found for this user/provider');
      const credentialId = creds.id;

      // Construct payload with dynamic credential id
      const nowISO = new Date().toISOString();
      const oneMonthLaterISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const maxAmountCents = caps.max_provider_charge_cents ?? 0;

      const mandatePayload = {
        provider: 'skiclubpro',
        program_ref: programRef,
        child_id: childId,
        scopes: [
          'scp:login',
          'scp:enroll',
          'scp:write:register',
          'scp:pay',
          'signupassist:fee',
        ],
        max_amount_cents: maxAmountCents,
        valid_from: nowISO,
        valid_until: oneMonthLaterISO,
        credential_id: credentialId,
        caps: {
          max_provider_charge_cents: maxAmountCents,
          service_fee_cents: 2000,
        },
      };
      console.log('[MandateSummary] mandate-issue payload', mandatePayload);
      const mand = await supabase.functions.invoke('mandate-issue', { body: mandatePayload });
      if (mand.error) throw new Error(mand.error.message || 'mandate-issue failed');

      console.log('[MandateSummary] ✅ mandate-issue returned', mand.data);
      const mandateId = mand.data?.mandate_id || mand.data?.id;
      if (!mandateId) throw new Error('mandate-issue returned no mandate_id');

      // 2️⃣  Create plan using mandate_id
      const planPayload = {
        provider: 'skiclubpro',
        program_ref: programRef,
        child_id: childId,
        opens_at: openTimeISO,
        mandate_id: mandateId,
      };
      console.log('[MandateSummary] 🚀 about to call create-plan', planPayload);
      const plan = await supabase.functions.invoke('create-plan', { body: planPayload });
      if (plan.error) throw new Error(plan.error.message || 'create-plan failed');
      console.log('[MandateSummary] ✅ create-plan success', plan.data);

      toast({
        title: 'Plan created successfully',
        description: `Plan ID: ${plan.data?.plan_id || 'ok'}`,
      });
      
      const planId = plan.data?.plan_id || plan.data?.id;
      if (planId) {
        onCreated(planId, mandateId);
      }
    } catch (err: any) {
      console.error('[MandateSummary] fatal', err);
      toast({
        title: 'Error',
        description: String(err?.message || err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Mandate Summary</CardTitle>
            <CardDescription>Confirm what you authorize us to do for this plan.</CardDescription>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                One-time authorization that covers login, registration, and payment for this plan.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2">
            <div><span className="text-muted-foreground">Organization:</span> <Badge variant="secondary">{orgRef}</Badge></div>
            <div><span className="text-muted-foreground">Program:</span> <strong>{programTitle}</strong></div>
            <div><span className="text-muted-foreground">Child:</span> <strong>{childName}</strong></div>
            <div><span className="text-muted-foreground">Opens:</span> <strong>{new Date(openTimeISO).toLocaleString()}</strong></div>
            <div><span className="text-muted-foreground">Preferred slot:</span> <strong>{preferredSlot}</strong></div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="font-medium">Payment limits</div>
            <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated total:</span>
                <strong>{fmtUSD(detectedPriceCents)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your payment cap:</span>
                <strong className="text-primary">{fmtUSD(caps.max_provider_charge_cents)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Success fee (only if we get the spot):</span>
                <strong>{fmtUSD(caps.service_fee_cents)}</strong>
              </div>
              <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                Final total will not exceed your {fmtUSD(caps.max_provider_charge_cents)} limit. We'll stop if the actual cost is higher.
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid gap-2">
            <div className="font-medium">What we will do</div>
            <ul className="list-disc pl-5">
              {scopeList.map(s => <li key={s.key}>{s.label}</li>)}
            </ul>
          </div>

          <Separator />

          <ReminderPreferences value={reminders} onChange={setReminders} />

          <Separator />

          <div className="grid gap-2">
            <div className="font-medium">Optional notes for our operator</div>
            <Textarea placeholder="Anything we should know? (allergies, carpool preference, etc.)" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <Separator />

          <Collapsible open={showMandateJSON} onOpenChange={setShowMandateJSON}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="font-medium">View Mandate JSON</span>
                {showMandateJSON ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-auto max-h-64">
                {JSON.stringify(mandateJSON, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          <div className="grid gap-3">
            {consentItems.map((consentText, idx) => (
              <label key={idx} className="flex items-start gap-2 cursor-pointer">
                <Checkbox 
                  checked={consents[idx]}
                  onCheckedChange={(v) => {
                    const newConsents = [...consents];
                    newConsents[idx] = !!v;
                    updateConsents(newConsents);
                  }}
                />
                <span className="text-sm leading-tight">{consentText}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              className="w-full"
              disabled={submitting}
              onClick={createPlanAndMandate}
            >
              {submitting ? 'Creating…' : 'Sign & Create Plan'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
