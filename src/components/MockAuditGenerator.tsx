import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Loader2, Zap } from 'lucide-react';

interface MockAuditGeneratorProps {
  mandates: Array<{ id: string; provider: string; program_ref: string | null }>;
  onEventCreated: () => void;
}

const EVENT_TYPES = [
  { value: 'tool_call', label: 'Tool Call' },
  { value: 'authorization', label: 'Authorization Check' },
  { value: 'payment', label: 'Payment' },
  { value: 'enrollment', label: 'Enrollment' }
];

const TOOLS = [
  'skiclubpro_login',
  'skiclubpro_register',
  'skiclubpro_pay',
  'skiclubpro_check_availability',
  'scp.check_prerequisites'
];

const DECISIONS = ['allowed', 'denied', 'pending'];

export function MockAuditGenerator({ mandates, onEventCreated }: MockAuditGeneratorProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [selectedMandate, setSelectedMandate] = useState('');
  const [eventType, setEventType] = useState('tool_call');
  const [tool, setTool] = useState(TOOLS[0]);
  const [decision, setDecision] = useState('allowed');

  const handleGenerateEvent = async () => {
    if (!user || !selectedMandate) {
      toast({
        title: "Error",
        description: "Please select a mandate first",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const mandate = mandates.find(m => m.id === selectedMandate);
      
      const { error } = (await supabase
        .from('audit_events')
        .insert({
          mandate_id: selectedMandate,
          event_type: eventType,
          tool,
          decision,
          provider: mandate?.provider || 'skiclubpro',
          org_ref: 'test-org',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          details: {
            test: true,
            generated_at: new Date().toISOString()
          },
          result: JSON.stringify({
            success: decision === 'allowed',
            message: `Mock ${eventType} event`,
            timestamp: new Date().toISOString()
          })
        })) as any;

      if (error) throw error;

      toast({
        title: "Success",
        description: "Mock audit event created"
      });

      onEventCreated();
    } catch (error) {
      console.error('Error creating mock audit event:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to create audit event',
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
          <Zap className="h-5 w-5" />
          Mock Audit Events Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Select Mandate</Label>
          <Select value={selectedMandate} onValueChange={setSelectedMandate}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a mandate" />
            </SelectTrigger>
            <SelectContent>
              {mandates.map((mandate) => (
                <SelectItem key={mandate.id} value={mandate.id}>
                  {mandate.provider} - {mandate.program_ref || 'N/A'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tool</Label>
            <Select value={tool} onValueChange={setTool}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOOLS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Decision</Label>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button 
          onClick={handleGenerateEvent} 
          disabled={loading || !selectedMandate}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate Mock Event'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}