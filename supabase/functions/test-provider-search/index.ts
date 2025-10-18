import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, location } = await req.json();
    
    if (!name) {
      return new Response(
        JSON.stringify({ error: 'Provider name is required' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    
    if (!googleApiKey) {
      console.error('GOOGLE_PLACES_API_KEY not found in environment');
      return new Response(
        JSON.stringify({ error: 'Google API key not configured' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build search query
    const query = `${name}${location ? ", " + location : ""}`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${googleApiKey}`;

    console.log(`🔍 Searching Google Places for: "${query}"`);

    // Call Google Places API
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Google API error:', data);
      return new Response(
        JSON.stringify({ 
          error: 'Google API error', 
          status: data.status, 
          message: data.error_message 
        }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = data.results || [];
    console.log(`✅ Found ${results.length} results`);

    // Format results
    const providers = results.slice(0, 3).map((r: any) => ({
      name: r.name,
      city: r.formatted_address?.split(",")[1]?.trim() || "",
      address: r.formatted_address,
      orgRef: r.place_id,
      source: "google",
      rating: r.rating,
      user_ratings_total: r.user_ratings_total,
    }));

    return new Response(
      JSON.stringify({ 
        query,
        count: providers.length,
        providers 
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in test-provider-search:', error);
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
