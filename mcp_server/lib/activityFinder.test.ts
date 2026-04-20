import { describe, expect, it, vi } from "vitest";
import { __activityFinderInternals, searchActivityFinder } from "./activityFinder.js";

describe("activity finder search", () => {
  it("uses typed city ahead of IP-inferred location", async () => {
    const searchPlaces = vi.fn(async (parsed) => {
      expect(parsed.city).toBe("Chicago");
      expect(parsed.state).toBe("IL");
      expect(parsed.locationSource).toBe("user_entered");
      return [
        {
          name: "Chicago Soccer Center",
          address: "123 Field St, Chicago, IL, USA",
          city: "Chicago",
          state: "IL",
          placeId: "place_123",
          website: "https://example.com/signup",
        },
      ];
    });

    const result = await searchActivityFinder(
      { query: "soccer at Chicago Soccer Center in Chicago IL for age 9" },
      {
        lookupIpLocation: async () => ({
          city: "Madison",
          state: "WI",
          source: "ip_inferred",
          confidence: "medium",
        }),
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Chicago Soccer Center",
          city: "Chicago",
          state: "IL",
          ageYears: 9,
        }),
        searchPlaces,
      },
    );

    expect(result.parsed.city).toBe("Chicago");
    expect(result.bestMatch?.status).toBe("guided_autopilot");
  });

  it("maps Keva to a Tested Fast Path", async () => {
    const result = await searchActivityFinder(
      { query: "soccer at Keva for age 9" },
      {
        lookupIpLocation: async () => ({
          city: "Madison",
          state: "WI",
          source: "ip_inferred",
          confidence: "medium",
        }),
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Keva",
          ageYears: 9,
        }),
        searchPlaces: async () => [
          {
            name: "Keva Sports Center",
            address: "8312 Forsythia St, Middleton, WI, USA",
            city: "Middleton",
            state: "WI",
            placeId: "keva_place",
            website: "https://www.kevasports.com",
          },
        ],
      },
    );

    expect(result.bestMatch).toMatchObject({
      status: "tested_fast_path",
      providerKey: "daysmart",
      providerName: "DaySmart / Dash",
      ctaLabel: "Set up signup help",
      confidence: 0.92,
      sourceFreshness: "Configured provider path",
      ageGradeFit: "Age 9",
      providerReadiness: "navigation verified",
    });
    expect(result.bestMatch?.targetUrl).toContain("daysmartrecreation.com");
  });

  it("maps known venues to a Tested Fast Path even when Places is unavailable", async () => {
    const result = await searchActivityFinder(
      { query: "soccer at Keva for age 9" },
      {
        lookupIpLocation: async () => ({
          city: "Madison",
          state: "WI",
          source: "ip_inferred",
          confidence: "medium",
        }),
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Keva",
          ageYears: 9,
        }),
        searchPlaces: async () => [],
      },
    );

    expect(result.bestMatch).toMatchObject({
      status: "tested_fast_path",
      providerKey: "daysmart",
      providerName: "DaySmart / Dash",
    });
    expect(result.bestMatch?.targetUrl).toContain("daysmartrecreation.com");
  });

  it("does not infer a tested fast path activity from venue-only wording", async () => {
    const searchPlaces = vi.fn(async () => []);
    const result = await searchActivityFinder(
      { query: "Keva in Madison for my 9 year old" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Keva",
          city: "Madison",
          state: "WI",
          ageYears: 9,
        }),
        searchPlaces,
      },
    );

    expect(result.bestMatch?.status).toBe("need_more_detail");
    expect(result.bestMatch?.missingDetails).toContain("activity");
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("keeps registration-like untested venues useful through Guided Autopilot", async () => {
    const result = await searchActivityFinder(
      { query: "swim lessons at Lakeside YMCA in Madison for age 7" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "swim lessons",
          venue: "Lakeside YMCA",
          city: "Madison",
          state: "WI",
          ageYears: 7,
        }),
        searchPlaces: async () => [
          {
            name: "Lakeside YMCA",
            address: "1 Pool Way, Madison, WI, USA",
            city: "Madison",
            state: "WI",
            placeId: "ymca_place",
            website: "https://ymca.example/signup",
          },
        ],
      },
    );

    expect(result.bestMatch?.status).toBe("guided_autopilot");
    expect(result.bestMatch).toMatchObject({
      confidence: 0.72,
      sourceFreshness: "Live venue lookup",
      ageGradeFit: "Age 7",
      providerReadiness: "generic",
    });
    expect(result.bestMatch?.explanation.toLowerCase()).not.toContain("unsupported");
  });

  it("downgrades generic venue homepages to signup-link confirmation", async () => {
    const result = await searchActivityFinder(
      { query: "swim lessons at Lakeside YMCA in Madison for age 7" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "swim lessons",
          venue: "Lakeside YMCA",
          city: "Madison",
          state: "WI",
          ageYears: 7,
        }),
        searchPlaces: async () => [
          {
            name: "Lakeside YMCA",
            address: "1 Pool Way, Madison, WI, USA",
            city: "Madison",
            state: "WI",
            placeId: "ymca_place",
            website: "https://ymca.example",
          },
        ],
      },
    );

    expect(result.bestMatch?.status).toBe("needs_signup_link");
    expect(result.bestMatch?.targetUrl).toBeNull();
  });

  it("asks for a signup link when a venue has no website", async () => {
    const result = await searchActivityFinder(
      { query: "basketball at Tiny Gym in Madison for age 8" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "basketball",
          venue: "Tiny Gym",
          city: "Madison",
          state: "WI",
          ageYears: 8,
        }),
        searchPlaces: async () => [
          {
            name: "Tiny Gym",
            address: "10 Main St, Madison, WI, USA",
            city: "Madison",
            state: "WI",
            placeId: "tiny_gym",
            website: null,
          },
        ],
      },
    );

    expect(result.bestMatch?.status).toBe("needs_signup_link");
    expect(result.bestMatch?.ctaLabel).toBe("Add signup link");
  });

  it("returns one friendly detail prompt instead of a dead end", async () => {
    const searchPlaces = vi.fn(async () => []);
    const result = await searchActivityFinder(
      { query: "camp" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "camp" }),
        searchPlaces,
      },
    );

    expect(result.bestMatch?.status).toBe("need_more_detail");
    expect(result.bestMatch?.missingDetails).toEqual(expect.arrayContaining(["provider or venue"]));
    expect(result.bestMatch?.explanation.toLowerCase()).not.toContain("unsupported");
    expect(result.otherMatches).toHaveLength(0);
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("does not display the searched city as the venue", async () => {
    const searchPlaces = vi.fn(async () => []);
    const result = await searchActivityFinder(
      { query: "basketball camps in Madison for age 10" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "basketball camps",
          venue: "Madison",
          city: "Madison",
          state: "WI",
          ageYears: 10,
        }),
        searchPlaces,
      },
    );

    expect(result.parsed.venue).toBeNull();
    expect(result.bestMatch?.status).toBe("need_more_detail");
    expect(result.bestMatch?.venueName).toBeNull();
    expect(result.bestMatch?.missingDetails).toContain("provider or venue");
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("blocks explicit adult-only searches before provider lookup", async () => {
    const searchPlaces = vi.fn(async () => []);
    const result = await searchActivityFinder(
      { query: "wine tasting class for adults only" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "wine tasting" }),
        searchPlaces,
      },
    );

    expect(result.outOfScope).toMatchObject({ reason: "adult_signup_request" });
    expect(result.bestMatch).toBeNull();
    expect(result.otherMatches).toHaveLength(0);
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("blocks innocuous adult participant sports for launch", async () => {
    const result = await searchActivityFinder(
      { query: "adult soccer league near me" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "soccer" }),
        searchPlaces: async () => [],
      },
    );

    expect(result.outOfScope?.message).toContain("Adult activity registration is not supported yet");
    expect(result.bestMatch).toBeNull();
  });

  it("does not treat generic participant wording as a youth cue", async () => {
    const result = await searchActivityFinder(
      { query: "adult participant soccer registration" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "soccer" }),
        searchPlaces: async () => [],
      },
    );

    expect(result.outOfScope).toMatchObject({ reason: "adult_signup_request" });
    expect(result.bestMatch).toBeNull();
  });

  it("allows parent-controlled child searches even when the parent is adult", async () => {
    const result = await searchActivityFinder(
      { query: "adult parent looking for soccer for my child age 9" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "soccer", ageYears: 9 }),
        searchPlaces: async () => [],
      },
    );

    expect(result.outOfScope).toBeNull();
    expect(result.bestMatch?.status).toBe("need_more_detail");
  });

  it("treats age 0 as missing, not a participant age", async () => {
    const result = await searchActivityFinder(
      { query: "soccer at Keva in Madison for age 0" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Keva",
          city: "Madison",
          state: "WI",
          ageYears: 0,
        }),
        searchPlaces: async () => [],
      },
    );

    expect(result.outOfScope).toBeNull();
    expect(result.parsed.ageYears).toBeNull();
    expect(result.bestMatch?.status).toBe("need_more_detail");
    expect(result.bestMatch?.missingDetails).toContain("age");
    expect(result.bestMatch?.ageGradeFit).not.toBe("Age 0");
  });

  it("treats adult participant ages as out of scope", async () => {
    const result = await searchActivityFinder(
      { query: "soccer league for age 21" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "soccer", ageYears: 21 }),
        searchPlaces: async () => [],
      },
    );

    expect(result.outOfScope).toMatchObject({ reason: "adult_signup_request" });
    expect(result.bestMatch).toBeNull();
  });

  it("filters remote live venue candidates when an explicit city/state exists", () => {
    const parsed = {
      activity: "basketball",
      venue: null,
      city: "Madison",
      state: "WI",
      ageYears: 10,
      grade: null,
      missingFields: [],
      locationSource: "user_entered" as const,
    };

    expect(
      __activityFinderInternals.candidateMatchesExplicitLocation(
        {
          name: "Remote Basketball",
          address: "1 Court St, Chicago, IL, USA",
          city: "Chicago",
          state: "IL",
          placeId: "remote",
          website: "https://example.com/signup",
        },
        parsed,
      ),
    ).toBe(false);
  });

  it("stores only minimized redacted Activity Finder search logs", async () => {
    const insert = vi.fn();
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await searchActivityFinder(
      {
        query:
          "soccer at Keva in Madison for age 9 email ava@example.com phone 608-555-0100 DOB 11/26/2014 https://provider.example/signup?token=secret",
        userId: "11111111-1111-4111-8111-111111111111",
      },
      {
        lookupIpLocation: async () => ({
          city: "Madison",
          state: "WI",
          lat: 43.0731,
          lng: -89.4012,
          source: "ip_inferred",
          confidence: "medium",
        }),
        parseQuery: async () => ({
          activity: "soccer",
          venue: "Keva",
          city: "Madison",
          state: "WI",
          ageYears: 9,
        }),
        searchPlaces: async () => [],
        supabase,
      },
    );

    const logged = insert.mock.calls[0][0];
    const serialized = JSON.stringify(logged);

    expect(logged.raw_query).toContain("[email]");
    expect(logged.raw_query).toContain("[phone]");
    expect(logged.raw_query).toContain("[date]");
    expect(logged.raw_query).toContain("[url]");
    expect(serialized).not.toContain("ava@example.com");
    expect(serialized).not.toContain("608-555-0100");
    expect(serialized).not.toContain("11/26/2014");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("43.0731");
    expect(serialized).not.toContain("-89.4012");
    expect(logged.best_match.targetUrlHost).toBe("pps.daysmartrecreation.com");
  });
});
