import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Key, Plus, Trash2, Info, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { Header } from '@/components/Header';

const credentialsSchema = z.object({
  alias: z.string().min(1, 'Alias is required').max(50, 'Alias must be less than 50 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type CredentialsForm = z.infer<typeof credentialsSchema>;

interface Credential {
  id: string;
  alias: string;
  provider: string;
  created_at: string;
}

export default function Credentials() {
  const { user, loading: authLoading } = useAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CredentialsForm>({
    resolver: zodResolver(credentialsSchema),
  });

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
      // Handle the new response format { credentials: array }
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

  const onSubmit = async (data: CredentialsForm) => {
    setSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('store-credentials', {
        body: {
          alias: data.alias,
          provider_slug: 'skiclubpro',
          email: data.email,
          password: data.password,
        }
      });

      if (error) {
        const errorMessage = error.message || 'Failed to store credentials.';
        throw new Error(errorMessage);
      }

      toast({
        title: 'Success',
        description: 'Credentials stored successfully!',
      });

      reset();
      setShowAddForm(false);
      await loadCredentials();
    } catch (error) {
      console.error('Error storing credentials:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to store credentials.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteCredential = async (credentialId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('cred-delete', {
        body: { id: credentialId }
      });

      if (error) {
        const errorMessage = error.message || 'Failed to delete credential.';
        throw new Error(errorMessage);
      }

      toast({
        title: 'Success',
        description: 'Credential deleted successfully!',
      });

      await loadCredentials();
    } catch (error) {
      console.error('Error deleting credential:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete credential.',
        variant: 'destructive',
      });
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
            <h1 className="text-3xl font-bold text-foreground">Credential Manager</h1>
            <p className="text-muted-foreground mt-2">
              Manage your SkiClubPro login credentials securely
            </p>
          </div>
          <Button onClick={() => navigate('/')} variant="outline">
            Back to Home
          </Button>
        </div>

        <div className="grid gap-6">
          {/* MCP Server URL Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                MCP Server URL
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertDescription>
                  Current MCP Server URL: https://signupassist-mcp-production.up.railway.app/
                </AlertDescription>
              </Alert>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="mt-3">
                    View Full URL
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>MCP Server URL</DialogTitle>
                    <DialogDescription>
                      This is the URL used to communicate with the MCP server.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="p-4 bg-muted rounded-md">
                    <code className="text-sm">https://signupassist-mcp-production.up.railway.app/</code>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Encryption Key Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Security Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertDescription>
                  Your credentials are encrypted using AES-GCM encryption before being stored. 
                  Make sure the CRED_SEAL_KEY is properly configured in your Supabase secrets.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Add Credentials */}
          <Card>
            <CardHeader>
              <CardTitle>Add New Credentials</CardTitle>
              <CardDescription>
                Store your SkiClubPro login credentials for automated access
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showAddForm ? (
                <Button onClick={() => setShowAddForm(true)} className="w-full">
                  <Plus className="h-4 w-4 mr-2" />
                  Add SkiClubPro Credentials
                </Button>
              ) : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div>
                    <Label htmlFor="alias">Alias</Label>
                    <Input
                      id="alias"
                      {...register('alias')}
                      placeholder="e.g., Primary Account"
                    />
                    {errors.alias && (
                      <p className="text-destructive text-sm mt-1">{errors.alias.message}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      {...register('email')}
                      placeholder="your@email.com"
                    />
                    {errors.email && (
                      <p className="text-destructive text-sm mt-1">{errors.email.message}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      {...register('password')}
                      placeholder="Your SkiClubPro password"
                    />
                    {errors.password && (
                      <p className="text-destructive text-sm mt-1">{errors.password.message}</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? 'Storing...' : 'Store Credentials'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowAddForm(false);
                        reset();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Existing Credentials */}
          <Card>
            <CardHeader>
              <CardTitle>Stored Credentials</CardTitle>
              <CardDescription>
                Your saved SkiClubPro login credentials
              </CardDescription>
            </CardHeader>
            <CardContent>
              {credentials.length === 0 ? (
                <div className="text-center py-8">
                  <Key className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No credentials stored yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Add your first SkiClubPro credentials to get started
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {credentials.map((credential) => (
                    <div
                      key={credential.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Key className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">{credential.alias}</p>
                          <p className="text-sm text-muted-foreground">
                            Added {new Date(credential.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Credential</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete "{credential.alias}"? This action cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="flex justify-end gap-2 mt-4">
                            <DialogTrigger asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogTrigger>
                            <Button
                              variant="destructive"
                              onClick={() => deleteCredential(credential.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
