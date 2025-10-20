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
        assistant_message: "Great! We'll work with Blackhawk Ski Club (Middleton, WI). 👍\n\nNext, I'll connect securely to their system to check class availability. You'll log in directly with Blackhawk Ski Club — I never see or store your password.",
        context_update: {
          provider: "skiclubpro",
          org_ref: "blackhawk-ski-club",
          org_name: "Blackhawk Ski Club",
          org_city: "Middleton, WI"
        }
      };
    } else if (userText.toLowerCase().includes("middleton")) {
      // Single match response
      response = {
        assistant_message: "Great news! I found **Blackhawk Ski Club** in Middleton, WI. Is that the one you mean?\n\n_We only use this info to look up your organization; your data stays private._",
        payload: {
          type: "provider_confirmation",
          data: {
            name: "Blackhawk Ski Club",
            location: "Middleton, WI",
            orgRef: "blackhawk-ski-club"
          }
        }
      };
    } else if (userText.toLowerCase().includes("blackhawk")) {
      // Multiple match response
      response = {
        assistant_message: "I found a few organizations named **Blackhawk**. Which one is yours?",
        payload: {
          type: "multiple_providers",
          data: [
            {
              name: "Blackhawk Ski Club",
              location: "Middleton, WI",
              orgRef: "blackhawk-ski-club"
            },
            {
              name: "Blackhawk Ski Club",
              location: "Madison, WI",
              orgRef: "blackhawk-ski-club-madison"
            }
          ]
        }
      };
    } else {
      // No match response
      response = {
        assistant_message: "Hmm, I didn't find an obvious match for that organization. Could you double-check the name or give me more info (like the city or school name)? 🤔\n\nDon't worry, we only use this info to look up your club, and your data stays private."
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
