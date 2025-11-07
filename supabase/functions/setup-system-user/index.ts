import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SetupSystemUserRequest {
  action: 'create' | 'check' | 'store_credentials';
  skiclubpro_email?: string;
  skiclubpro_password?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const body: SetupSystemUserRequest = await req.json();
    const { action, skiclubpro_email, skiclubpro_password } = body;

    const SYSTEM_EMAIL = 'system@signupassist.internal';
    const SYSTEM_PASSWORD = Deno.env.get('SYSTEM_USER_PASSWORD') || 'SystemUser2024!SecurePassword';

    // Action: Check if system user exists
    if (action === 'check') {
      const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) throw error;

      const systemUser = users.users.find(u => u.email === SYSTEM_EMAIL);
      
      if (!systemUser) {
        return new Response(
          JSON.stringify({
            exists: false,
            message: 'System user not found. Use action=create to set it up.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if credentials are stored
      const { data: creds, error: credsError } = await supabaseAdmin
        .from('stored_credentials')
        .select('id, provider, alias')
        .eq('user_id', systemUser.id)
        .eq('provider', 'skiclubpro')
        .single();

      return new Response(
        JSON.stringify({
          exists: true,
          user_id: systemUser.id,
          email: systemUser.email,
          credentials_stored: !!creds,
          credential_alias: creds?.alias,
          message: creds 
            ? 'System user configured with SkiClubPro credentials'
            : 'System user exists but no SkiClubPro credentials stored'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Create system user
    if (action === 'create') {
      // Check if already exists
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existing = existingUsers?.users.find(u => u.email === SYSTEM_EMAIL);

      if (existing) {
        return new Response(
          JSON.stringify({
            success: false,
            user_id: existing.id,
            message: 'System user already exists'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create the user
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: SYSTEM_EMAIL,
        password: SYSTEM_PASSWORD,
        email_confirm: true, // Auto-confirm
        user_metadata: {
          role: 'system',
          purpose: 'cache_scraping'
        }
      });

      if (createError) throw createError;

      console.log('[setup-system-user] Created system user:', newUser.user.id);

      return new Response(
        JSON.stringify({
          success: true,
          user_id: newUser.user.id,
          email: SYSTEM_EMAIL,
          message: 'System user created successfully. Next: store SkiClubPro credentials using action=store_credentials'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Store SkiClubPro credentials for system user
    if (action === 'store_credentials') {
      if (!skiclubpro_email || !skiclubpro_password) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Missing skiclubpro_email or skiclubpro_password'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get system user
      const { data: users } = await supabaseAdmin.auth.admin.listUsers();
      const systemUser = users?.users.find(u => u.email === SYSTEM_EMAIL);

      if (!systemUser) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'System user not found. Run action=create first.'
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Encrypt credentials using the store-credentials function
      const storeCredsResponse = await supabaseAdmin.functions.invoke('store-credentials', {
        body: {
          provider: 'skiclubpro',
          alias: 'system_cache_scraper',
          data: {
            email: skiclubpro_email,
            password: skiclubpro_password
          },
          user_id: systemUser.id
        }
      });

      if (storeCredsResponse.error) {
        console.error('[setup-system-user] Failed to store credentials:', storeCredsResponse.error);
        throw storeCredsResponse.error;
      }

      console.log('[setup-system-user] Stored credentials for system user');

      return new Response(
        JSON.stringify({
          success: true,
          user_id: systemUser.id,
          credential_id: storeCredsResponse.data?.id,
          message: 'SkiClubPro credentials stored for system user. Cache refresh is now ready!'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        message: 'Invalid action. Use: check, create, or store_credentials'
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[setup-system-user] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
