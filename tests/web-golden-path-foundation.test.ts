import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityFinderStatusLabel,
  searchActivityFinder,
  type ActivityFinderParsed,
  type ActivityFinderResult,
} from "../src/lib/activityFinder";
import {
  buildAutopilotIntentPath,
  buildSignupIntentFromFinderResult,
} from "../src/lib/signupIntent";

const forbiddenRouteParams = [
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
];

const parsed: ActivityFinderParsed = {
  activity: "soccer",
  venue: "Keva",
  city: "Madison",
  state: "WI",
  ageYears: 9,
  grade: null,
  missingFields: [],
  locationSource: "user_entered",
};

const testedFastPath: ActivityFinderResult = {
  status: "tested_fast_path",
  venueName: "Keva Sports Center",
  address: "8312 Forsythia St, Middleton, WI",
  activityLabel: "Soccer",
  targetUrl: "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva",
  providerKey: "daysmart",
  providerName: "DaySmart / Dash",
  ctaLabel: "Prepare signup",
  explanation: "Known DaySmart signup path.",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web golden path foundation", () => {
  it("keeps Activity Finder API calls narrow and bearer-token based", async () => {
    const responseBody = {
      parsed,
      bestMatch: testedFastPath,
      otherMatches: [],
    };
    const fetchMock = vi.fn(async () => jsonResponse(responseBody));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { origin: "https://signupassist.shipworx.ai" } });

    const result = await searchActivityFinder("soccer at Keva in Madison for age 9", "jwt-token");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/api/activity-finder/search");
    expect(requestUrl.search).toBe("");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-token",
    });
    expect(body).toEqual({ query: "soccer at Keva in Madison for age 9" });
    expect(JSON.stringify(body)).not.toContain("userId");
    expect(result.bestMatch?.providerKey).toBe("daysmart");
  });

  it("surfaces backend search errors without falling into a fake success state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "backend_unavailable" }, { status: 503 })));
    vi.stubGlobal("window", { location: { origin: "https://signupassist.shipworx.ai" } });

    await expect(searchActivityFinder("soccer")).rejects.toThrow("backend_unavailable");
  });

  it("records every Activity Finder result state expected by the browser golden path", () => {
    expect(activityFinderStatusLabel("tested_fast_path")).toBe("Tested Fast Path");
    expect(activityFinderStatusLabel("guided_autopilot")).toBe("Guided Autopilot");
    expect(activityFinderStatusLabel("needs_signup_link")).toBe("Needs signup link");
    expect(activityFinderStatusLabel("need_more_detail")).toBe("Need one more detail");
  });

  it("blocks missing-detail results before a signup intent can be created", () => {
    const payload = buildSignupIntentFromFinderResult({
      query: "soccer",
      parsed: {
        ...parsed,
        missingFields: ["age"],
      },
      result: {
        ...testedFastPath,
        status: "need_more_detail",
        targetUrl: null,
      },
    });

    expect(payload).toBeNull();
  });

  it("allows a parent-confirmed signup link to enter the secure intent bridge", () => {
    const confirmedUrl = "https://pps.daysmartrecreation.com/dash/index.php?action=Auth/login&company=keva";
    const payload = buildSignupIntentFromFinderResult({
      query: "soccer at Keva",
      parsed,
      result: {
        ...testedFastPath,
        status: "needs_signup_link",
        targetUrl: confirmedUrl,
      },
    });

    expect(payload).toMatchObject({
      source: "activity_finder",
      finderStatus: "needs_signup_link",
      targetUrl: confirmedUrl,
      providerKey: "daysmart",
      providerName: "DaySmart / Dash",
    });
  });

  it("keeps the Autopilot browser URL to exactly one opaque intent id", () => {
    const path = buildAutopilotIntentPath("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
    const url = new URL(path, "https://signupassist.shipworx.ai");

    expect(url.pathname).toBe("/autopilot");
    expect([...url.searchParams.keys()]).toEqual(["intent"]);
    expect(url.searchParams.get("intent")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
    forbiddenRouteParams.forEach((key) => expect(url.searchParams.has(key)).toBe(false));
  });

  it("keeps the Activity Finder component wired to auth redirect and intent-only plan opening", () => {
    const page = readFileSync("src/pages/ActivityFinder.tsx", "utf8");
    const authPage = readFileSync("src/pages/auth.tsx", "utf8");
    const navigateCalls = page
      .split("\n")
      .filter((line) => line.includes("navigate("))
      .join("\n");

    expect(page).toContain('result.status === "need_more_detail"');
    expect(page).toContain('sessionStorage.setItem("signupassist:returnTo", "/activity-finder")');
    expect(page).toContain('navigate("/auth?returnTo=%2Factivity-finder")');
    expect(authPage).toContain("useSearchParams");
    expect(authPage).toContain("safeReturnTo");
    expect(authPage).toContain("sessionStorage.getItem('signupassist:returnTo')");
    expect(authPage).toContain("navigate(returnTo)");
    expect(page).toContain("createSignupIntent(payload)");
    expect(page).toContain("setPrepareIntentId(intent.id)");
    expect(page).toContain("PreparePlanSheet");
    expect(page).not.toContain("buildAutopilotIntentPath");
    forbiddenRouteParams.forEach((key) => expect(navigateCalls).not.toContain(`${key}=`));
  });
});
