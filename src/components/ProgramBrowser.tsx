import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, AlertCircle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  onProgramSelect: (program: { ref: string; title: string }) => void;
  selectedProgram?: string;
}

export function ProgramBrowser({ onProgramSelect, selectedProgram }: ProgramBrowserProps) {
  const [open, setOpen] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const { toast } = useToast();

  // Fetch user's SkiClubPro credentials
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setHasCredentials(false);
          return;
        }

        const { data, error } = await supabase.functions.invoke('cred-list');
        if (error) throw error;

        const skiClubProCreds = data?.credentials?.filter((cred: any) => cred.provider === 'skiclubpro');
        if (skiClubProCreds && skiClubProCreds.length > 0) {
          setCredentialId(skiClubProCreds[0].id);
          setHasCredentials(true);
        } else {
          setHasCredentials(false);
        }
      } catch (error) {
        console.error('Error loading credentials:', error);
        setHasCredentials(false);
      }
    };

    loadCredentials();
  }, []);

  const fetchPrograms = async (query?: string) => {
    if (!credentialId) {
      toast({
        title: "Credentials Required",
        description: "Please add your Blackhawk (SkiClubPro) login in Settings before browsing live programs.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      // Informative toast at start
      toast({
        title: "Connecting to Blackhawk…",
        description: "We'll log into your Blackhawk account and fetch live program listings.",
      });

      const { data, error } = await supabase.functions.invoke('mcp-executor', {
        body: {
          tool: 'scp:find_programs',
          args: {
            query: query || undefined,
            credential_id: credentialId,
            user_jwt: session.access_token,
            org_ref: 'blackhawk-ski-club'
          }
        }
      });

      if (error) throw error;

      // ✅ Handle standardized ProviderResponse format
      if (data?.login_status === 'success') {
        toast({
          title: "Connected to Blackhawk",
          description: "Login successful. Live programs loaded.",
        });
        // Extract programs from data.data.programs (ProviderResponse structure)
        setPrograms(data?.data?.programs || []);
      } else {
        // login_status === 'failed' or missing
        toast({
          title: "Login Failed",
          description: data?.error || "Could not log into Blackhawk. Please recheck your credentials.",
          variant: "destructive"
        });
        // Still show fallback data if available
        setPrograms(data?.data?.programs || []);
      }
    } catch (error: any) {
      console.error('Error fetching programs:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to load programs. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && hasCredentials) {
      // fresh fetch on open
      setPrograms([]);
      fetchPrograms();
    }
  };

  const handleSearch = () => {
    fetchPrograms(searchQuery);
  };

  const handleProgramSelect = (program: Program) => {
    // Warn if a title accidentally made it into program_ref
    if (program.program_ref && program.program_ref.includes(' ')) {
      console.warn('ProgramBrowser WARNING: program_ref contains spaces (may be a human title):', program.program_ref);
    }
    onProgramSelect({ ref: program.program_ref, title: program.title });
    setOpen(false);
  };

  const getSelectedProgramTitle = () => {
    if (!selectedProgram) return null;
    const program = programs.find(p => p.program_ref === selectedProgram);
    return program?.title || selectedProgram;
  };

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="outline" type="button" className="w-full">
                {selectedProgram ? getSelectedProgramTitle() : 'Browse Available Programs'}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            This will log into your Blackhawk (SkiClubPro) account to fetch live program data.
          </TooltipContent>
        </Tooltip>

        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Select a Program
                </DialogTitle>
                <DialogDescription>
                  We'll connect to your <strong>Blackhawk Ski Club</strong> account (SkiClubPro) to load
                  live program listings. Make sure your credentials are saved in Settings.
                </DialogDescription>
              </div>

              {/* Credentials badge */}
              {hasCredentials === true ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800">
                  Login Ready
                </Badge>
              ) : hasCredentials === false ? (
                <Badge variant="destructive">
                  No Credentials
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          <div className="flex gap-2 mb-4 px-1">
            <Input
              placeholder="Search programs (e.g., beginner, saturday, snowboard)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {hasCredentials === false ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please add your Blackhawk (SkiClubPro) credentials in Settings before browsing programs.
                </AlertDescription>
              </Alert>
            ) : loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Fetching live programs from Blackhawk…
              </div>
            ) : programs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? 'No programs found matching your search.' : 'Click search to load programs.'}
              </div>
            ) : (
              <div className="grid gap-4">
                {programs.map((program) => (
                  <Card
                    key={program.id}
                    className="cursor-pointer transition-all hover:shadow-md"
                    onClick={() => handleProgramSelect(program)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <CardTitle className="text-lg mb-1">{program.title}</CardTitle>
                          <CardDescription>{program.description}</CardDescription>
                        </div>
                        <Badge variant="secondary" className="ml-2">
                          {program.skill_level}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="font-medium text-muted-foreground">Schedule:</span>
                          <p>{program.schedule}</p>
                        </div>
                        <div>
                          <span className="font-medium text-muted-foreground">Age Range:</span>
                          <p>{program.age_range}</p>
                        </div>
                        <div>
                          <span className="font-medium text-muted-foreground">Price:</span>
                          <p>{program.price}</p>
                        </div>
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