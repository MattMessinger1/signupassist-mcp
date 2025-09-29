import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();

  const fetchPrograms = async (query?: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mcp-executor', {
        body: {
          tool: 'scp:find_programs',
          args: query ? { query } : {}
        }
      });

      if (error) throw error;

      if (data?.programs) {
        console.log('Programs received from MCP:', data.programs);
        console.log('First program structure:', data.programs[0]);
        setPrograms(data.programs);
      } else {
        console.log('No programs in MCP response:', data);
        setPrograms([]);
      }
    } catch (error) {
      console.error('Error fetching programs:', error);
      toast({
        title: "Error",
        description: "Failed to load programs. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && programs.length === 0) {
      fetchPrograms();
    }
  };

  const handleSearch = () => {
    fetchPrograms(searchQuery);
  };

  const handleProgramSelect = (program: Program) => {
    console.log('Program selected in browser:', program.title, program.program_ref);
    onProgramSelect({ ref: program.program_ref, title: program.title });
    setOpen(false);
  };

  const getSelectedProgramTitle = () => {
    if (!selectedProgram) return null;
    const program = programs.find(p => p.program_ref === selectedProgram);
    return program?.title || selectedProgram;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" type="button" className="w-full">
          {selectedProgram ? getSelectedProgramTitle() : 'Browse Available Programs'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select a Program</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Search programs (e.g., beginner, saturday, snowboard)..."
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
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading programs...
            </div>
          ) : programs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No programs found matching your search.' : 'No programs available.'}
            </div>
          ) : (
            <div className="grid gap-4">
              {programs.map((program) => (
                <Card 
                  key={program.id} 
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedProgram === program.program_ref ? 'ring-2 ring-primary' : ''
                  }`}
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
  );
}