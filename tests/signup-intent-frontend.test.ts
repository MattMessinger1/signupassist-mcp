import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAutopilotIntentPath,
  buildSignupIntentFromFinderResult,
} from "../src/lib/signupIntent";

const parsed = {
  activity: "soccer",
  venue: "Keva",
  city: "Madison",
  state: "WI",
  ageYears: 9,
  grade: null,
  missingFields: [],
  locationSource: "user_entered" as const,
};

const result = {
  status: "guided_autopilot" as const,
  venueName: "Keva Sports Center",
  address: "8312 Forsythia St, Middleton, WI",
  activityLabel: "Soccer",
  targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
  providerKey: "daysmart",
  providerName: "DaySmart / Dash",
  ctaLabel: "Set up signup help",
  explanation: "Found a guided signup path.",
};

describe("signup intent frontend bridge", () => {
  it("does not create signup intents for need_more_detail results", () => {
    expect(
      buildSignupIntentFromFinderResult({
        query: "soccer",
        parsed,
        result: {
          ...result,
          status: "need_more_detail",
        },
      }),
    ).toBeNull();
  });

  it("builds an Autopilot URL with only the server-side intent id", () => {
    const path = buildAutopilotIntentPath("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
    const url = new URL(path, "https://app.signupassist.test");

    expect(url.pathname).toBe("/autopilot");
    expect([...url.searchParams.keys()]).toEqual(["intent"]);
    expect(url.searchParams.get("intent")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");

    [
      "finderQuery",
      "activity",
      "venue",
      "address",
      "age",
      "grade",
      "location",
      "targetUrl",
      "providerName",
      "providerKey",
      "child",
      "profile",
    ].forEach((forbiddenParam) => {
      expect(url.searchParams.has(forbiddenParam)).toBe(false);
    });
  });

  it("maps Activity Finder results into a server-side intent payload", () => {
    const payload = buildSignupIntentFromFinderResult({
      query: "soccer at Keva in Madison for age 9",
      parsed,
      result,
    });

    expect(payload).toMatchObject({
      source: "activity_finder",
      originalQuery: "soccer at Keva in Madison for age 9",
      targetUrl: result.targetUrl,
      providerKey: "daysmart",
      providerName: "DaySmart / Dash",
      finderStatus: "guided_autopilot",
    });
    expect(payload?.parsed?.ageYears).toBe(9);
  });

  it("keeps Activity Finder navigation on the signup intent bridge", () => {
    const page = readFileSync("src/pages/ActivityFinder.tsx", "utf8");
    const activityFinderHelper = readFileSync("src/lib/activityFinder.ts", "utf8");

    expect(page).toContain("createSignupIntent");
    expect(page).toContain("buildAutopilotIntentPath(intent.id)");
    expect(page).not.toContain("finderQuery");
    expect(page).not.toContain("targetUrl:");
    expect(activityFinderHelper).not.toContain("userId");
  });

  it("keeps the web-only signup intent bridge out of MCP approval surfaces", () => {
    const manifest = readFileSync("mcp/manifest.json", "utf8");
    const openapi = JSON.parse(readFileSync("mcp/openapi.json", "utf8")) as {
      paths?: Record<string, Record<string, { operationId?: string }>>;
    };
    const operationIds = Object.values(openapi.paths ?? {})
      .flatMap((pathItem) => Object.values(pathItem))
      .map((operation) => operation.operationId)
      .filter(Boolean)
      .sort();

    expect(manifest).not.toContain("signup-intents");
    expect(JSON.stringify(openapi)).not.toContain("/api/signup-intents");
    expect(operationIds).toEqual(["register_for_activity", "search_activities"]);
  });
});
