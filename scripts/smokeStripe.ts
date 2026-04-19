#!/usr/bin/env tsx
/**
 * Stripe smoke checks.
 *
 * Non-destructive: verifies Stripe credentials and, when configured, the
 * SignupAssist Autopilot monthly price.
 */
import "dotenv/config";
import Stripe from "stripe";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const stripeKey = requiredEnv("STRIPE_SECRET_KEY");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const autopilotPriceId = process.env.STRIPE_AUTOPILOT_PRICE_ID;
  const requireWebhookSecret = ["1", "true", "yes"].includes(
    String(process.env.STRIPE_SMOKE_REQUIRE_WEBHOOK || "").toLowerCase(),
  );

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-04-10" });
  const balance = await stripe.balance.retrieve();
  console.log(`[ok] Stripe credentials valid; available balance currencies: ${balance.available.map((b) => b.currency).join(", ") || "none"}`);

  if (!webhookSecret && requireWebhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required when STRIPE_SMOKE_REQUIRE_WEBHOOK=1");
  } else if (!webhookSecret) {
    console.log("[warn] STRIPE_WEBHOOK_SECRET is not set; this is a credential smoke only, not webhook proof");
  } else {
    console.log("[ok] STRIPE_WEBHOOK_SECRET is configured");
  }

  if (autopilotPriceId) {
    const price = await stripe.prices.retrieve(autopilotPriceId);
    const amount = price.unit_amount || 0;
    const interval = price.recurring?.interval || "none";
    if (amount !== 900 || interval !== "month") {
      throw new Error(`Autopilot price expected 900/month, got ${amount}/${interval}`);
    }
    console.log("[ok] STRIPE_AUTOPILOT_PRICE_ID is $9/month");
  } else {
    console.log("[warn] STRIPE_AUTOPILOT_PRICE_ID not set; subscription checkout will use inline $9/month price data");
  }

  console.log("[ok] Stripe smoke complete");
}

main().catch((error) => {
  console.error("[fail] Stripe smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
