import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus } from 'lucide-react';

interface CreateTestMandateProps {
  onMandateCreated: () => void;
}

const AVAILABLE_SCOPES = [
  'login',
  'enroll',
  'pay',
  'check_availability',
  'check_prerequisites'
];

export function CreateTestMandate({ onMandateCreated }: CreateTestMandateProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('skiclubpro');
  const [programRef, setProgramRef] = useState('test-program');
  const [childId, setChildId] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [maxAmountCents, setMaxAmountCents] = useState('50000');
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  });
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['login', 'enroll', 'pay']);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to create a mandate",
        variant: "destructive"
      });
      return;
    }

    if (selectedScopes.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one scope",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mandate-issue', {
        body: {
          provider,
          program_ref: programRef,
          child_id: childId || crypto.randomUUID(),
          credential_id: credentialId || crypto.randomUUID(),
          max_amount_cents: parseInt(maxAmountCents),
          valid_from: new Date().toISOString(),
          valid_until: new Date(validUntil).toISOString(),
          scope: selectedScopes
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Test mandate created successfully"
      });

      onMandateCreated();
      
      // Reset form
      setSelectedScopes(['login', 'enroll', 'pay']);
    } catch (error) {
      console.error('Error creating test mandate:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to create test mandate',
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Create Test Mandate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Input
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="programRef">Program Reference</Label>
              <Input
                id="programRef"
                value={programRef}
                onChange={(e) => setProgramRef(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="childId">Child ID (optional)</Label>
              <Input
                id="childId"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                placeholder="Leave empty to auto-generate"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="credentialId">Credential ID (optional)</Label>
              <Input
                id="credentialId"
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
                placeholder="Leave empty to auto-generate"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxAmount">Max Amount (cents)</Label>
              <Input
                id="maxAmount"
                type="number"
                value={maxAmountCents}
                onChange={(e) => setMaxAmountCents(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="validUntil">Valid Until</Label>
              <Input
                id="validUntil"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scopes</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {AVAILABLE_SCOPES.map((scope) => (
                <div key={scope} className="flex items-center space-x-2">
                  <Checkbox
                    id={`scope-${scope}`}
                    checked={selectedScopes.includes(scope)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedScopes([...selectedScopes, scope]);
                      } else {
                        setSelectedScopes(selectedScopes.filter(s => s !== scope));
                      }
                    }}
                  />
                  <label
                    htmlFor={`scope-${scope}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {scope}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Test Mandate'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}