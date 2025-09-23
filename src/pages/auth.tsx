import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export default function AuthPage() {
  const navigate = useNavigate();
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    // Check if user is already authenticated
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/plan-builder');
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/plan-builder');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handlePasskeyAuth = async () => {
    setPasskeyLoading(true);
    try {
      const { error } = await supabase.auth.signInWithSSO({
        providerId: 'passkey',
        options: {
          redirectTo: `${window.location.origin}/plan-builder`
        }
      });
      
      if (error) {
        console.error('Passkey authentication error:', error);
      }
    } catch (error) {
      console.error('Passkey authentication failed:', error);
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Welcome to SignupAssist</h1>
          <p className="text-muted-foreground">Sign in to manage your enrollment plans</p>
        </div>
        
        {/* Passkey Authentication */}
        <div className="mb-6">
          <Button 
            onClick={handlePasskeyAuth}
            disabled={passkeyLoading}
            className="w-full"
            variant="outline"
          >
            {passkeyLoading ? 'Authenticating...' : '🔐 Sign in with Passkey'}
          </Button>
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with
            </span>
          </div>
        </div>

        <Auth
          supabaseClient={supabase}
          providers={['google', 'apple']}
          appearance={{ 
            theme: ThemeSupa,
            style: {
              button: {
                background: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
                borderRadius: '0.375rem',
              },
              anchor: {
                color: 'hsl(var(--primary))',
              },
            },
          }}
          theme="light"
          redirectTo={`${window.location.origin}/plan-builder`}
        />
      </div>
    </div>
  );
}