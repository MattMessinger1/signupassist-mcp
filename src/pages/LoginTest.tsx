import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Header } from '@/components/Header';

interface Credential {
  id: string;
  alias: string;
  provider: string;
  created_at: string;
}

export default function LoginTest() {
  const { user, loading: authLoading } = useAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedCredential, setSelectedCredential] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    } else if (user) {
      loadCredentials();
    }
  }, [user, authLoading, navigate]);

  const loadCredentials = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('cred-list');
      if (error) throw error;
      const credentialsArray = data?.credentials || data || [];
      setCredentials(credentialsArray);
    } catch (error) {
      console.error('Error loading credentials:', error);
      toast({
        title: 'Error',
        description: 'Failed to load credentials.',
        variant: 'destructive',
      });
    }
  };

  const testLogin = async () => {
    if (!selectedCredential) {
      toast({
        title: 'Error',
        description: 'Please select a credential to test.',
        variant: 'destructive',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      console.log('Testing login with credential:', selectedCredential);
      
      const { data, error } = await supabase.functions.invoke('skiclubpro-tools', {
        body: {
          tool: 'scp.login',
          args: {
            credential_id: selectedCredential,
            user_jwt: session.access_token,
            org_ref: 'blackhawk-ski-club'
          }
        }
      });

      console.log('Login test response:', data);

      if (error) {
        console.error('Function invocation error:', error);
        throw error;
      }

      console.log('Login test response data:', data);

      if (data?.error) {
        setTestResult({
          success: false,
          message: data.error,
          details: data
        });
        toast({
          title: 'Login Failed',
          description: data.error,
          variant: 'destructive',
        });
      } else if (data?.success) {
        setTestResult({
          success: true,
          message: 'Login successful!',
          details: data
        });
        toast({
          title: 'Login Successful',
          description: 'Successfully authenticated with SkiClubPro!',
        });
      } else {
        // Handle unexpected response format
        setTestResult({
          success: false,
          message: 'Unexpected response format',
          details: data
        });
        toast({
          title: 'Test Failed',
          description: 'Received unexpected response from server',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error testing login:', error);
      
      // Extract the most useful error message
      let errorMessage = 'Unknown error';
      let errorDetails = error;
      
      if (error?.message) {
        errorMessage = error.message;
      }
      
      // Check if there's a response body with more details
      if (error?.context?.body) {
        try {
          const body = typeof error.context.body === 'string' 
            ? JSON.parse(error.context.body) 
            : error.context.body;
          if (body?.error) {
            errorMessage = body.error;
            errorDetails = body;
          }
        } catch (e) {
          console.error('Failed to parse error body:', e);
        }
      }
      
      setTestResult({
        success: false,
        message: errorMessage,
        details: errorDetails
      });
      toast({
        title: 'Login Test Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Login Test</h1>
            <p className="text-muted-foreground mt-2">
              Test your SkiClubPro login credentials
            </p>
          </div>
          <Button onClick={() => navigate('/')} variant="outline">
            Back to Home
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Test SkiClubPro Login</CardTitle>
            <CardDescription>
              Select a credential and test the login functionality
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Credential</label>
              <Select value={selectedCredential} onValueChange={setSelectedCredential}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a credential to test" />
                </SelectTrigger>
                <SelectContent>
                  {credentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id}>
                      {cred.alias} ({cred.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {credentials.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No credentials found. <a href="/credentials" className="text-primary underline">Add credentials first</a>
                </p>
              )}
            </div>

            <Button 
              onClick={testLogin} 
              disabled={testing || !selectedCredential}
              className="w-full"
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Login...
                </>
              ) : (
                'Test Login'
              )}
            </Button>

            {testResult && (
              <Alert className={testResult.success ? 'border-green-500' : 'border-destructive'}>
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive mt-0.5" />
                  )}
                  <div className="flex-1">
                    <AlertDescription>
                      <p className="font-semibold mb-2">{testResult.message}</p>
                      {testResult.details && (
                        <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto mt-2">
                          {JSON.stringify(testResult.details, null, 2)}
                        </pre>
                      )}
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
