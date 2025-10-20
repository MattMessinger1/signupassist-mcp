import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface SupabaseConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupabaseConfigModal({ open, onOpenChange }: SupabaseConfigModalProps) {
  const [supabaseUrl, setSupabaseUrl] = useState('https://jpcrphdevmvzcfgokgym.supabase.co');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyConfig = () => {
    const config = `SUPABASE_URL=${supabaseUrl}\nSUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`;
    navigator.clipboard.writeText(config);
    setCopied(true);
    toast.success('Configuration copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (!supabaseUrl || !serviceRoleKey) {
      toast.error('Please fill in all fields');
      return;
    }
    
    // Validate URL format
    try {
      new URL(supabaseUrl);
    } catch {
      toast.error('Invalid Supabase URL format');
      return;
    }

    // Copy to clipboard for manual .env update
    handleCopyConfig();
    toast.success('Configuration ready! Update your .env file with the copied values.');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Configure Supabase Credentials</DialogTitle>
          <DialogDescription>
            Enter your Supabase project credentials. These will be copied to your clipboard to add to your .env file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <Alert>
            <AlertDescription className="text-sm">
              Find these values in your Supabase Dashboard → Settings → API
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="supabase-url">Supabase URL</Label>
            <Input
              id="supabase-url"
              placeholder="https://your-project.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value.trim())}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Example: https://jpcrphdevmvzcfgokgym.supabase.co
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-role-key">Service Role Key (Secret)</Label>
            <Input
              id="service-role-key"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={serviceRoleKey}
              onChange={(e) => setServiceRoleKey(e.target.value.trim())}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              ⚠️ Use the Service Role Key, NOT the anon key
            </p>
          </div>

          <Alert variant="destructive">
            <AlertDescription className="text-sm">
              <strong>Security Warning:</strong> Never commit the Service Role Key to your repository. 
              Only add it to your local .env file.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleCopyConfig}
            disabled={!supabaseUrl || !serviceRoleKey}
            className="w-full sm:w-auto"
          >
            {copied ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Config
              </>
            )}
          </Button>
          <Button 
            onClick={handleSave}
            disabled={!supabaseUrl || !serviceRoleKey}
            className="w-full sm:w-auto"
          >
            Save & Copy to Clipboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
