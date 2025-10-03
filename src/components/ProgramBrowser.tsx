import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

  const fetchPrograms = async (query?: string) => {
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

      toast({ title: "Connecting to Blackhawk…", description: "Fetching live program listings." });

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
      if (error) throw error;

      // Check for login failure
      if (data?.login_status === 'failed') {
        throw new Error(data?.error || 'Login failed');
      }

      // Handle nested data structure: data.data.programs or fallback to data.programs
      const programs = data?.data?.programs || data?.programs;
      
      if (Array.isArray(programs)) {
        setPrograms(programs);
      } else {
        setPrograms([]);
      }
    } catch (err: any) {
      toast({ title: "Error loading programs", description: err?.message || 'Unknown error', variant: "destructive" });
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
    setOpen(false);
  };

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="outline" type="button" className="w-full">
                {selectedProgram ? 'Change Program' : 'Browse Available Programs'}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">This logs into Blackhawk (SkiClubPro) to load live programs.</TooltipContent>
        </Tooltip>

        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2"><Info className="h-4 w-4" /> Select a Program</DialogTitle>
                <DialogDescription>We'll connect to your Blackhawk account to load live listings.</DialogDescription>
              </div>
              <Badge variant={credentialId ? 'secondary' : 'destructive'}>
                {credentialId ? 'Login Ready' : 'No Credentials'}
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex gap-2 mb-4 px-1">
            <Input
              placeholder="Search programs (e.g., beginner, saturday)…"
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
              <div className="text-center py-8 text-muted-foreground">Click search to load programs.</div>
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