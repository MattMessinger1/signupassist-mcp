import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, ExternalLink } from 'lucide-react';
import { SupabaseConfigModal } from './SupabaseConfigModal';

export function EnvConfigHelper() {
  const [configModalOpen, setConfigModalOpen] = useState(false);

  return (
    <>
      <Card className="max-w-2xl mx-auto mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Environment Configuration
          </CardTitle>
          <CardDescription>
            Configure your Supabase credentials for the MCP server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Required Environment Variables:</h3>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li>SUPABASE_URL</li>
              <li>SUPABASE_SERVICE_ROLE_KEY</li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => setConfigModalOpen(true)} className="w-full sm:w-auto">
              <Settings className="mr-2 h-4 w-4" />
              Configure Credentials
            </Button>
            <Button
              variant="outline"
              asChild
              className="w-full sm:w-auto"
            >
              <a
                href="https://supabase.com/dashboard/project/jpcrphdevmvzcfgokgym/settings/api"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Supabase API Settings
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>

          <div className="bg-muted p-4 rounded-md text-sm space-y-2">
            <p className="font-semibold">After copying the configuration:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Open your <code className="bg-background px-1 rounded">.env</code> file</li>
              <li>Replace the placeholder values with your copied configuration</li>
              <li>Save the file</li>
              <li>Restart your development server</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <SupabaseConfigModal 
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
      />
    </>
  );
}
