import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        }
      }
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { provider } = await req.json();
    
    if (!provider) {
      throw new Error('Provider is required');
    }

    console.log(`Fetching credentials for user ${user.id} and provider ${provider}`);

    // Fetch stored credentials for the user and provider
    const { data: credentials, error } = await supabase
      .from('stored_credentials')
      .select('id, alias, provider, created_at')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching credentials:', error);
      throw new Error('Failed to fetch credentials');
    }

    console.log(`Found ${credentials?.length || 0} credentials`);

    return new Response(
      JSON.stringify({
        credentials: credentials || []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in cred-list function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal server error'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});