// supabase/functions/orchestrator-test/index.ts
// 💖 Lovable Edge Function for running SignupAssist orchestration securely

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1️⃣ Parse the incoming JSON from your invoke call
    const { userText, sessionId = "edge-test" } = await req.json();

    console.log(`[orchestrator-test] Processing request for session: ${sessionId}`);
    console.log(`[orchestrator-test] User text: ${userText}`);

    // 2️⃣ Load OpenAI API key securely from Supabase secrets
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured in Supabase secrets");
    }

    // 3️⃣ For now, return a structured response that matches the Disambiguation flow
    // This is a stub - you'll replace this with actual AIOrchestrator integration
    // when the TypeScript import paths are resolved
    
    // Simple router logic based on user input
    let response;
    
    if (userText.toLowerCase().includes("yes") || userText.toLowerCase().includes("that's it")) {
      // Provider confirmation response
      response = {
        assistant_message: "Great! We'll work with AIM Design (Bookeo). 👍\n\nNext, I'll use their program catalog to check class availability. API access is configured on our side — you sign in with the provider when prompted.",
        context_update: {
          provider: "bookeo",
          org_ref: "aim-design",
          org_name: "AIM Design",
          org_city: "Online / regional programs"
        }
      };
    } else if (userText.toLowerCase().includes("aim") || userText.toLowerCase().includes("design")) {
      // Single match response
      response = {
        assistant_message: "Great news! I found **AIM Design** (Bookeo). Is that the one you mean?\n\n_We only use this to look up programs; your data stays private._",
        payload: {
          type: "provider_confirmation",
          data: {
            name: "AIM Design",
            location: "Programs via Bookeo",
            orgRef: "aim-design"
          }
        }
      };
    } else if (userText.toLowerCase().includes("bookeo") || userText.toLowerCase().includes("classes")) {
      // Multiple match response
      response = {
        assistant_message: "I found a few organizations that might match. Which one is yours?",
        payload: {
          type: "multiple_providers",
          data: [
            {
              name: "AIM Design",
              location: "Primary catalog",
              orgRef: "aim-design"
            },
            {
              name: "AIM Design — alternate site",
              location: "Secondary listing",
              orgRef: "aim-design-alt"
            }
          ]
        }
      };
    } else {
      // No match response
      response = {
        assistant_message: "Hmm, I didn't find an obvious match for that organization. Could you double-check the name or give me more info (like the city or program type)? 🤔\n\nDon't worry, we only use this to look up your provider, and your data stays private."
      };
    }

    console.log(`[orchestrator-test] Returning response:`, response);

    // 4️⃣ Return assistant output as structured JSON
    return new Response(JSON.stringify(response, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("❌ Orchestrator Edge Error:", err);
    return new Response(
      JSON.stringify({
        error: err.message,
        hint: "Double-check your secrets or input JSON.",
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      },
    );
  }
});
