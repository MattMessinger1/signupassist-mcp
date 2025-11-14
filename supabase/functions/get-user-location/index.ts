import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Force redeploy to pick up IPAPI_KEY secret (2025-11-14)
// CORS headers to allow calls from our frontend
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory cache for IP lookups (TTL: 15 minutes)
const cache: Record<string, { 
  data: { lat: number; lng: number; city: string; region: string; mock: boolean; reason?: string }, 
  timestamp: number 
}> = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract client IP address from incoming request headers
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIP = req.headers.get("x-real-ip");
    const cfIP = req.headers.get("cf-connecting-ip");
    let clientIp = forwardedFor?.split(",")[0]?.trim() || realIP || cfIP || null;

    console.log("[get-user-location] IP extraction:", { forwardedFor, realIP, cfIP, clientIp });

    // Check cache first (skip localhost IPs)
    if (clientIp && clientIp !== "127.0.0.1" && clientIp !== "::1" && cache[clientIp]) {
      const cachedEntry = cache[clientIp];
      if (Date.now() - cachedEntry.timestamp < CACHE_TTL) {
        console.log(`[get-user-location] ✅ Cache hit for IP: ${clientIp}`);
        return new Response(JSON.stringify(cachedEntry.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      } else {
        // Cache expired, remove it
        delete cache[clientIp];
        console.log(`[get-user-location] Cache expired for IP: ${clientIp}`);
      }
    }

    // Handle localhost/development (return mock location)
    if (!clientIp || clientIp === "127.0.0.1" || clientIp === "::1") {
      console.warn("[get-user-location] Localhost detected - returning mock Madison location");
      return new Response(
        JSON.stringify({
          lat: 43.0731,
          lng: -89.4012,
          city: "Madison",
          region: "Wisconsin",
          mock: true,
          reason: "localhost"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Check for IPAPI key (optional - use mock if not configured)
    const apiKey = Deno.env.get("IPAPI_KEY");
    if (!apiKey) {
      console.warn("[get-user-location] IPAPI_KEY not configured - returning mock Madison location");
      return new Response(
        JSON.stringify({
          lat: 43.0731,
          lng: -89.4012,
          city: "Madison",
          region: "Wisconsin",
          mock: true,
          reason: "no_api_key"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Call ipapi.co for real location lookup
    const apiUrl = `https://ipapi.co/${clientIp}/json/?key=${apiKey}`;
    console.log(`[get-user-location] Calling ipapi.co for IP: ${clientIp}`);
    
    const resp = await fetch(apiUrl, { headers: { "Accept": "application/json" } });
    
    if (!resp.ok) {
      console.error("[get-user-location] ipapi.co API error:", resp.status);
      // Fallback to mock on API error
      return new Response(
        JSON.stringify({
          lat: 43.0731,
          lng: -89.4012,
          city: "Madison",
          region: "Wisconsin",
          mock: true,
          reason: "api_error"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const data = await resp.json();
    console.log("[get-user-location] ipapi.co response:", { 
      city: data.city, 
      region: data.region, 
      hasCoords: !!(data.latitude && data.longitude) 
    });

    // Validate response has location data
    if (!data || data.error || data.latitude === undefined || data.longitude === undefined) {
      console.error("[get-user-location] Invalid response from ipapi.co:", data);
      // Fallback to mock on invalid response
      return new Response(
        JSON.stringify({
          lat: 43.0731,
          lng: -89.4012,
          city: "Madison",
          region: "Wisconsin",
          mock: true,
          reason: "invalid_response"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Return real location (city-level only - privacy compliant)
    const result = {
      lat: data.latitude,
      lng: data.longitude,
      city: data.city,
      region: data.region,
      mock: false
    };

    // Store in cache
    if (clientIp) {
      cache[clientIp] = { data: result, timestamp: Date.now() };
      console.log(`[get-user-location] Cached result for IP: ${clientIp}`);
    }

    console.log("[get-user-location] ✅ Real location detected:", result);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("[get-user-location] Unexpected error:", error);
    // Fallback to mock on any error
    return new Response(
      JSON.stringify({
        lat: 43.0731,
        lng: -89.4012,
        city: "Madison",
        region: "Wisconsin",
        mock: true,
        reason: "error"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
