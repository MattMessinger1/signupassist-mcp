import { describe, expect, it } from "vitest";
import {
  getSubscriptionDisplay,
  isAutopilotSubscriptionUsable,
  isSubscriptionPaidThrough,
} from "../src/lib/subscription";

const now = new Date("2026-04-15T12:00:00.000Z");

describe("autopilot subscription status", () => {
  it("permits active subscriptions", () => {
    const subscription = {
        status: "active",
        cancel_at_period_end: false,
        current_period_end: "2026-05-15T12:00:00.000Z",
    };

    expect(isAutopilotSubscriptionUsable(subscription, now)).toBe(true);
    expect(getSubscriptionDisplay(subscription as any).description).toContain(
      "No success fee is charged for supervised autopilot",
    );
  });

  it("keeps access through the paid period after renewal cancellation", () => {
    const subscription = {
      status: "active",
      cancel_at_period_end: true,
      current_period_end: "2026-05-15T12:00:00.000Z",
    };

    expect(isSubscriptionPaidThrough(subscription, now)).toBe(true);
    expect(isAutopilotSubscriptionUsable(subscription, now)).toBe(true);
    expect(getSubscriptionDisplay(subscription as any).description).toContain("You won't be charged again");
  });

  it("blocks missing and expired canceled subscriptions", () => {
    expect(isAutopilotSubscriptionUsable(null, now)).toBe(false);
    expect(
      isAutopilotSubscriptionUsable({
        status: "canceled",
        cancel_at_period_end: true,
        current_period_end: "2026-03-15T12:00:00.000Z",
      }, now),
    ).toBe(false);
  });

  it("does not treat checkout-started as active", () => {
    expect(
      isAutopilotSubscriptionUsable({
        status: "checkout_started",
        cancel_at_period_end: false,
        current_period_end: null,
      }, now),
    ).toBe(false);
  });
});
