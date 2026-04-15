import type { Database } from "@/integrations/supabase/types";

export const AUTOPILOT_PLAN_ID = "signupassist_autopilot_monthly";
export const AUTOPILOT_PLAN_NAME = "SignupAssist Autopilot";
export const AUTOPILOT_PRICE_CENTS = 900;
export const AUTOPILOT_PRICE_LABEL = "$9/month";

export type UserSubscription =
  Database["public"]["Tables"]["user_subscriptions"]["Row"];

export function centsToDollars(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

export function formatAccessDate(dateValue?: string | null) {
  if (!dateValue) return "the end of your paid period";

  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateValue));
}

export function isSubscriptionPaidThrough(
  subscription?: Pick<UserSubscription, "current_period_end"> | null,
  now: Date = new Date(),
) {
  if (!subscription?.current_period_end) return false;
  return new Date(subscription.current_period_end).getTime() > now.getTime();
}

export function isAutopilotSubscriptionUsable(
  subscription?: Pick<
    UserSubscription,
    "status" | "cancel_at_period_end" | "current_period_end"
  > | null,
  now: Date = new Date(),
) {
  if (!subscription) return false;

  if (subscription.status === "active" || subscription.status === "trialing") {
    return true;
  }

  return (
    subscription.cancel_at_period_end &&
    subscription.status === "canceled" &&
    isSubscriptionPaidThrough(subscription, now)
  );
}

export function getSubscriptionDisplay(subscription?: UserSubscription | null) {
  if (!subscription) {
    return {
      label: "No monthly plan yet",
      description: "Subscribe when you are ready to run supervised autopilot.",
      nextChargeLabel: "No charge scheduled",
      canCancel: false,
      isUsable: false,
    };
  }

  const isUsable = isAutopilotSubscriptionUsable(subscription);
  const accessDate = formatAccessDate(subscription.current_period_end);

  if (subscription.cancel_at_period_end) {
    return {
      label: "Renewal canceled",
      description: `You won't be charged again. Access continues until ${accessDate}.`,
      nextChargeLabel: `Access through ${accessDate}`,
      canCancel: false,
      isUsable,
    };
  }

  if (subscription.status === "active" || subscription.status === "trialing") {
    return {
      label: "Active",
      description: "Supervised autopilot is available for real signup runs.",
      nextChargeLabel: subscription.current_period_end
        ? `Next charge ${accessDate}`
        : "Monthly renewal active",
      canCancel: true,
      isUsable,
    };
  }

  if (subscription.status === "checkout_started") {
    return {
      label: "Checkout started",
      description: "Finish Stripe Checkout to unlock supervised autopilot.",
      nextChargeLabel: "No charge confirmed yet",
      canCancel: false,
      isUsable: false,
    };
  }

  return {
    label: "Inactive",
    description: "Subscribe to unlock supervised autopilot.",
    nextChargeLabel: "No charge scheduled",
    canCancel: false,
    isUsable: false,
  };
}

async function getSupabaseClient() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

export async function fetchUserSubscription(userId: string) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function startSubscriptionCheckout(returnPath = "/autopilot") {
  const supabase = await getSupabaseClient();
  const origin = window.location.origin;
  const { data, error } = await supabase.functions.invoke("stripe-subscription-checkout", {
    body: {
      success_url: `${origin}${returnPath}?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${returnPath}?subscription=canceled`,
    },
  });

  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error("No subscription checkout URL returned");
  window.location.assign(data.url);
}

export async function finalizeSubscriptionCheckout(sessionId: string) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("stripe-subscription-success", {
    body: { session_id: sessionId },
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function cancelMonthlyRenewal() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("stripe-subscription-cancel", {
    body: {},
  });

  if (error) throw new Error(error.message);
  return data;
}
