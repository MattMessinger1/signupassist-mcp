import { describe, expect, it, vi } from "vitest";
import { searchActivityFinder } from "./activityFinder.js";

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
          website: "https://example.com",
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

  it("keeps untested venues useful through Guided Autopilot", async () => {
    const result = await searchActivityFinder(
      { query: "swim lessons at Lakeside YMCA for age 7" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "swim lessons",
          venue: "Lakeside YMCA",
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

    expect(result.bestMatch?.status).toBe("guided_autopilot");
    expect(result.bestMatch?.explanation.toLowerCase()).not.toContain("unsupported");
  });

  it("asks for a signup link when a venue has no website", async () => {
    const result = await searchActivityFinder(
      { query: "basketball at Tiny Gym for age 8" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({
          activity: "basketball",
          venue: "Tiny Gym",
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
    const result = await searchActivityFinder(
      { query: "camp" },
      {
        lookupIpLocation: async () => null,
        parseQuery: async () => ({ activity: "camp" }),
        searchPlaces: async () => [],
      },
    );

    expect(result.bestMatch?.status).toBe("need_more_detail");
    expect(result.bestMatch?.explanation.toLowerCase()).not.toContain("unsupported");
    expect(result.otherMatches).toHaveLength(0);
  });
});
