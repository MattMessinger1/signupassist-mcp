import { useState, useEffect } from 'react';
import { Key, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface Credential {
  id: string;
  alias: string;
  provider: string;
  created_at: string;
}

interface CredentialPickerProps {
  provider: string;
  value?: string;
  onChange: (credentialId: string) => void;
}

export function CredentialPicker({ provider, value, onChange }: CredentialPickerProps) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (provider) {
      loadCredentials();
    }
  }, [provider]);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('cred-list');

      if (error) throw error;

      // Filter credentials by provider client-side and ensure we have the correct structure
      const filteredCredentials = (data?.credentials || data || []).filter(
        (c: Credential) => c.provider === provider
      );
      
      setCredentials(filteredCredentials);
      
      if (filteredCredentials.length === 0) {
        toast({
          title: 'No Credentials Found',
          description: `No stored credentials found for ${provider}. Please add credentials first.`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error loading credentials:', error);
      toast({
        title: 'Error',
        description: `Failed to load stored credentials: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center space-x-2">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        <span className="text-sm text-muted-foreground">Loading credentials...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="credential-select">Login Credentials</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={loadCredentials}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {credentials.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select saved login..." />
          </SelectTrigger>
          <SelectContent>
            {credentials.map((credential) => (
              <SelectItem key={credential.id} value={credential.id}>
                <div className="flex items-center space-x-2">
                  <Key className="h-4 w-4" />
                  <span>{credential.alias}</span>
                  <span className="text-xs text-muted-foreground">
                    (Added {new Date(credential.created_at).toLocaleDateString()})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="text-center p-4 border-2 border-dashed border-muted rounded-lg">
          <Key className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            No stored credentials for {provider}
          </p>
          <p className="text-xs text-muted-foreground">
            Add credentials using the credentials management page
          </p>
        </div>
      )}
    </div>
  );
}