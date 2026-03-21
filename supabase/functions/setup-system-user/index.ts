import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SetupSystemUserRequest {
  action: 'create' | 'check';
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
    const { action } = body;

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

      return new Response(
        JSON.stringify({
          exists: true,
          user_id: systemUser.id,
          email: systemUser.email,
          message: 'System user is configured for internal automation tasks.'
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
          purpose: 'system_automation'
        }
      });

      if (createError) throw createError;

      console.log('[setup-system-user] Created system user:', newUser.user.id);

      return new Response(
        JSON.stringify({
          success: true,
          user_id: newUser.user.id,
          email: SYSTEM_EMAIL,
          message: 'System user created successfully.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        message: 'Invalid action. Use: check or create'
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
