import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, CreditCard, Loader2, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  AUTOPILOT_PLAN_NAME,
  AUTOPILOT_PRICE_LABEL,
  cancelMonthlyRenewal,
  fetchUserSubscription,
  finalizeSubscriptionCheckout,
  formatAccessDate,
  getSubscriptionDisplay,
  startSubscriptionCheckout,
  type UserSubscription,
} from "@/lib/subscription";
import { SUPERVISED_AUTOPILOT_BILLING_COPY } from "@/lib/autopilot/runPacket";

interface BillingCardProps {
  userId?: string | null;
  returnPath?: string;
  onSubscriptionChange?: (subscription: UserSubscription | null) => void;
  showPostRunActions?: boolean;
}

export function BillingCard({
  userId,
  returnPath = "/autopilot",
  onSubscriptionChange,
  showPostRunActions = false,
}: BillingCardProps) {
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const display = useMemo(() => getSubscriptionDisplay(subscription), [subscription]);
  const priceLabel = subscription?.price_cents
    ? `${AUTOPILOT_PRICE_LABEL}`
    : AUTOPILOT_PRICE_LABEL;

  const loadSubscription = useCallback(async () => {
    if (!userId) {
      setSubscription(null);
      setLoading(false);
      onSubscriptionChange?.(null);
      return;
    }

    try {
      setErrorMessage(null);
      const row = await fetchUserSubscription(userId);
      setSubscription(row);
      onSubscriptionChange?.(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load billing status";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, [onSubscriptionChange, userId]);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  useEffect(() => {
    const subscriptionResult = searchParams.get("subscription");
    const sessionId = searchParams.get("session_id");
    let isMounted = true;

    if (subscriptionResult === "success" && sessionId && userId) {
      setVerificationLoading(true);
      const verifySubscription = async () => {
        try {
          await finalizeSubscriptionCheckout(sessionId);
          if (!isMounted) return;

          toast({
            title: "Membership active",
            description: "Supervised autopilot is ready. Cancel renewal is available here whenever you want it.",
          });
          await loadSubscription();
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("subscription");
          nextParams.delete("session_id");
          setSearchParams(nextParams, { replace: true });
        } catch (error) {
          if (!isMounted) return;
          toast({
            title: "Subscription needs verification",
            description: error instanceof Error ? error.message : "Please refresh billing status.",
            variant: "destructive",
          });
        } finally {
          if (isMounted) setVerificationLoading(false);
        }
      };

      verifySubscription();
    } else if (subscriptionResult === "canceled") {
      toast({
        title: "Checkout canceled",
        description: "No monthly charge was started.",
      });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("subscription");
      setSearchParams(nextParams, { replace: true });
    }

    return () => {
      isMounted = false;
    };
  }, [loadSubscription, searchParams, setSearchParams, toast, userId]);

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      await startSubscriptionCheckout(returnPath);
    } catch (error) {
      setCheckoutLoading(false);
      toast({
        title: "Could not start subscription",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = async () => {
    setCancelLoading(true);
    try {
      const result = await cancelMonthlyRenewal();
      await loadSubscription();
      const accessDate = formatAccessDate(result?.current_period_end || subscription?.current_period_end);

      toast({
        title: "Renewal canceled",
        description: `You won't be charged again. Access continues until ${accessDate}.`,
      });
    } catch (error) {
      toast({
        title: "Could not cancel renewal",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {AUTOPILOT_PLAN_NAME}
            </CardTitle>
            <CardDescription>
              {priceLabel}. Supervised signup autopilot for Chrome desktop.
            </CardDescription>
          </div>
          <Badge variant={display.isUsable ? "default" : "secondary"}>
            {verificationLoading ? "Verifying" : display.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || verificationLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking billing status...
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-background p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Current plan
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{display.description}</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  Renewal
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{display.nextChargeLabel}</p>
              </div>
            </div>

            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {SUPERVISED_AUTOPILOT_BILLING_COPY.noSuccessFee}{" "}
                {SUPERVISED_AUTOPILOT_BILLING_COPY.providerFee}{" "}
                {SUPERVISED_AUTOPILOT_BILLING_COPY.futureSuccessFee}
              </AlertDescription>
            </Alert>

            {errorMessage && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            {showPostRunActions && display.isUsable && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Run finished. Keep membership active for the next signup window, or cancel renewal now.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {!display.isUsable && (
                <Button onClick={handleCheckout} disabled={checkoutLoading || !userId}>
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening Stripe...
                    </>
                  ) : (
                    <>
                      <CreditCard className="h-4 w-4" />
                      Start {AUTOPILOT_PRICE_LABEL}
                    </>
                  )}
                </Button>
              )}

              {showPostRunActions && display.isUsable && display.canCancel && (
                <Button
                  onClick={() =>
                    toast({
                      title: "Membership stays active",
                      description: "You are set for the next signup window.",
                    })
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Keep membership active
                </Button>
              )}

              {display.isUsable && (
                <Button variant="outline" onClick={loadSubscription}>
                  <RefreshCcw className="h-4 w-4" />
                  Refresh billing
                </Button>
              )}

              {display.canCancel && (
                <Button variant="destructive" onClick={handleCancel} disabled={cancelLoading}>
                  {cancelLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Canceling renewal...
                    </>
                  ) : (
                    "Cancel monthly renewal"
                  )}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              No dark patterns: no email-to-cancel, no forced survey, and canceling renewal never deletes family profiles.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
