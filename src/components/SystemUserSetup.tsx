import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, Loader2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SystemUserStatus {
  exists: boolean;
  user_id?: string;
  credentials_stored?: boolean;
  message?: string;
}

export function SystemUserSetup() {
  const [status, setStatus] = useState<SystemUserStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [skiclubproEmail, setSkiclubproEmail] = useState('');
  const [skiclubproPassword, setSkiclubproPassword] = useState('');
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const checkStatus = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('setup-system-user', {
        body: { action: 'check' }
      });

      if (error) throw error;
      setStatus(data);
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const createSystemUser = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('setup-system-user', {
        body: { action: 'create' }
      });

      if (error) throw error;
      
      if (data.success) {
        setResult({ type: 'success', message: data.message });
        await checkStatus(); // Refresh status
      } else {
        setResult({ type: 'error', message: data.message });
      }
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const storeCredentials = async () => {
    if (!skiclubproEmail || !skiclubproPassword) {
      setResult({ type: 'error', message: 'Please enter both email and password' });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('setup-system-user', {
        body: {
          action: 'store_credentials',
          skiclubpro_email: skiclubproEmail,
          skiclubpro_password: skiclubproPassword
        }
      });

      if (error) throw error;
      
      if (data.success) {
        setResult({ type: 'success', message: data.message });
        setSkiclubproEmail('');
        setSkiclubproPassword('');
        await checkStatus(); // Refresh status
      } else {
        setResult({ type: 'error', message: data.message });
      }
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>System User Setup</CardTitle>
        <CardDescription>
          Set up the system user for automated cache scraping operations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Check */}
        <div className="space-y-2">
          <Button onClick={checkStatus} disabled={loading} variant="outline" className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Check System User Status'
            )}
          </Button>

          {status && (
            <Alert className={status.exists ? 'border-green-500' : 'border-amber-500'}>
              <div className="flex items-start gap-2">
                {status.exists ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                ) : (
                  <Info className="h-5 w-5 text-amber-500 mt-0.5" />
                )}
                <div className="flex-1">
                  <AlertDescription>
                    {status.message}
                    {status.exists && status.user_id && (
                      <div className="mt-2 text-xs font-mono">
                        User ID: {status.user_id}
                      </div>
                    )}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          )}
        </div>

        {/* Step 1: Create System User */}
        {status && !status.exists && (
          <div className="space-y-2 border-t pt-4">
            <h3 className="font-semibold">Step 1: Create System User</h3>
            <p className="text-sm text-muted-foreground">
              Creates system@signupassist.internal in Supabase Auth
            </p>
            <Button onClick={createSystemUser} disabled={loading} className="w-full">
              Create System User
            </Button>
          </div>
        )}

        {/* Step 2: Store SkiClubPro Credentials */}
        {status && status.exists && !status.credentials_stored && (
          <div className="space-y-4 border-t pt-4">
            <h3 className="font-semibold">Step 2: Store SkiClubPro Credentials</h3>
            <p className="text-sm text-muted-foreground">
              Store actual SkiClubPro login credentials for the system user
            </p>
            
            <div className="space-y-2">
              <Label htmlFor="skiclubpro-email">SkiClubPro Email</Label>
              <Input
                id="skiclubpro-email"
                type="email"
                placeholder="your@email.com"
                value={skiclubproEmail}
                onChange={(e) => setSkiclubproEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="skiclubpro-password">SkiClubPro Password</Label>
              <Input
                id="skiclubpro-password"
                type="password"
                placeholder="••••••••"
                value={skiclubproPassword}
                onChange={(e) => setSkiclubproPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <Button onClick={storeCredentials} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Storing...
                </>
              ) : (
                'Store Credentials'
              )}
            </Button>
          </div>
        )}

        {/* Success State */}
        {status && status.exists && status.credentials_stored && (
          <Alert className="border-green-500">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertDescription>
              System user is fully configured! You can now use the "Refresh Cache" button.
            </AlertDescription>
          </Alert>
        )}

        {/* Result Messages */}
        {result && (
          <Alert className={result.type === 'success' ? 'border-green-500' : 'border-red-500'}>
            <div className="flex items-start gap-2">
              {result.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500 mt-0.5" />
              )}
              <AlertDescription>{result.message}</AlertDescription>
            </div>
          </Alert>
        )}

        {/* Info Box */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>How it works:</strong>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>System user: dedicated account for cache operations</li>
              <li>Credentials: stored encrypted in database</li>
              <li>Audit trail: all operations logged with system user ID</li>
              <li>Scheduled: can run nightly via pg_cron</li>
            </ul>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
