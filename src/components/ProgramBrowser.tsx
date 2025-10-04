import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { prompts } from '@/lib/prompts';

interface Program {
  id: string;
  program_ref: string;
  title: string;
  description: string;
  schedule: string;
  age_range: string;
  skill_level: string;
  price: string;
}

interface ProgramBrowserProps {
  credentialId: string | null;                 // ✅ pass from parent
  onProgramSelect: (program: { ref: string; title: string }) => void;
  selectedProgram?: string;
  orgRef?: string;                              // default 'blackhawk-ski-club'
}

export function ProgramBrowser({ credentialId, onProgramSelect, selectedProgram, orgRef = 'blackhawk-ski-club' }: ProgramBrowserProps) {
  const [open, setOpen] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();

  // Debug logging for programs state changes
  useEffect(() => {
    console.log('[ProgramBrowser] Programs state changed:', {
      count: programs.length,
      programs: programs
    });
  }, [programs]);

  const fetchPrograms = async (query?: string) => {
    console.log('[ProgramBrowser] fetchPrograms called with query:', query);
    console.log('[ProgramBrowser] credentialId:', credentialId);
    console.log('[ProgramBrowser] orgRef:', orgRef);
    
    if (!credentialId) {
      toast({
        title: "Select an account",
        description: "Choose your Blackhawk (SkiClubPro) credential first.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No active session');

      toast({ title: "Connecting…", description: prompts.ui.programs.helper('Blackhawk') });

      console.log('[ProgramBrowser] Invoking mcp-executor with args:', {
        tool: 'scp:find_programs',
        credential_id: credentialId,
        org_ref: orgRef,
        query
      });

      const { data, error } = await supabase.functions.invoke('mcp-executor', {
        body: {
          tool: 'scp:find_programs',
          args: {
            query: query || undefined,
            credential_id: credentialId,
            user_jwt: session.access_token,
            org_ref: orgRef
          }
        }
      });
      
      console.log('[ProgramBrowser] Raw response from mcp-executor:', data);
      console.log('[ProgramBrowser] Error from mcp-executor:', error);
      
      if (error) throw error;

      // Check for login failure
      if (data?.login_status === 'failed') {
        console.error('[ProgramBrowser] Login failed:', data?.error);
        throw new Error(data?.error || 'Login failed');
      }

      // Handle nested data structure: data.data.programs or fallback to data.programs
      const programs = data?.data?.programs || data?.programs;
      
      console.log('[ProgramBrowser] Extracted programs:', programs);
      console.log('[ProgramBrowser] Programs is array?:', Array.isArray(programs));
      console.log('[ProgramBrowser] Programs length:', programs?.length);
      
      if (Array.isArray(programs)) {
        console.log('[ProgramBrowser] Setting programs state with', programs.length, 'programs');
        setPrograms(programs);
      } else {
        console.warn('[ProgramBrowser] Programs is not an array, setting empty array');
        setPrograms([]);
      }
    } catch (err: any) {
      console.error('[ProgramBrowser] Error in fetchPrograms:', err);
      toast({ title: "Error", description: err?.message || prompts.ui.programs.loadError, variant: "destructive" });
      setPrograms([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      setPrograms([]);
      fetchPrograms();
    }
  };

  const handleProgramSelect = (p: Program) => {
    onProgramSelect({ ref: p.program_ref, title: p.title });
    toast({ description: prompts.ui.programs.toastSelected(p.title) });
    setOpen(false);
  };

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="outline" type="button" className="w-full">
                {selectedProgram ? prompts.ui.cta.changeProgram : prompts.ui.cta.fetchPrograms}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{prompts.ui.programs.helper('Blackhawk')}</TooltipContent>
        </Tooltip>

        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2"><Info className="h-4 w-4" /> {prompts.ui.titles.program}</DialogTitle>
                <DialogDescription>{prompts.ui.programs.helper('Blackhawk')}</DialogDescription>
              </div>
              <Badge variant={credentialId ? 'secondary' : 'destructive'}>
                {credentialId ? 'Login Ready' : 'No Credentials'}
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex gap-2 mb-4 px-1">
            <Input
              placeholder={prompts.ui.programs.searchPh}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchPrograms(searchQuery)}
              className="flex-1"
            />
            <Button onClick={() => fetchPrograms(searchQuery)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!credentialId ? (
              <div className="text-center py-8 text-muted-foreground">
                Add your Blackhawk credentials in Settings, then try again.
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…</div>
            ) : programs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? prompts.ui.programs.empty : 'Click search to load programs.'}
              </div>
            ) : (
              <div className="grid gap-4">
                {programs.map((program) => (
                  <Card key={program.id} className="cursor-pointer transition-all hover:shadow-md" onClick={() => handleProgramSelect(program)}>
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <CardTitle className="text-lg mb-1">{program.title}</CardTitle>
                          <CardDescription>{program.description}</CardDescription>
                        </div>
                        <Badge variant="secondary" className="ml-2">{program.skill_level}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div><span className="font-medium text-muted-foreground">Schedule:</span><p>{program.schedule}</p></div>
                        <div><span className="font-medium text-muted-foreground">Age Range:</span><p>{program.age_range}</p></div>
                        <div><span className="font-medium text-muted-foreground">Price:</span><p>{program.price}</p></div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}