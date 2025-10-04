import { useState, useEffect } from 'react';
import { Plus, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { prompts } from '@/lib/prompts';

interface Child {
  id: string;
  name: string;
  dob: string | null;
}

interface ChildSelectProps {
  value?: string;
  onChange: (childId: string) => void;
}

export function ChildSelect({ value, onChange }: ChildSelectProps) {
  const [children, setChildren] = useState<Child[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChild, setNewChild] = useState({ name: '', dob: '' });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadChildren();
  }, []);

  const loadChildren = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setChildren([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('children')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        if (error.message?.includes('Not authenticated')) {
          setChildren([]);
          setLoading(false);
          return;
        }
        throw error;
      }
      setChildren(data || []);
    } catch (error) {
      console.error('Error loading children:', error);
      toast({
        title: 'Error',
        description: 'Failed to load children.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addChild = async () => {
    if (!newChild.name.trim()) {
      toast({
        title: 'Error',
        description: 'Child name is required.',
        variant: 'destructive',
      });
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: 'Authentication Required',
          description: 'Please log in again to add a child.',
          variant: 'destructive',
        });
        return;
      }

      const childData = {
        user_id: user.id,
        name: newChild.name.trim(),
        dob: newChild.dob || null,
      };

      const { data, error } = await supabase
        .from('children')
        .insert([childData])
        .select()
        .single();

      if (error) {
        if (error.message?.includes('Not authenticated')) {
          toast({
            title: 'Session Expired',
            description: 'Please log in again to add a child.',
            variant: 'destructive',
          });
          return;
        }
        throw error;
      }

      // Reload children list to ensure consistency
      await loadChildren();
      
      // Set the new child as selected
      onChange(data.id);
      setNewChild({ name: '', dob: '' });
      setShowAddForm(false);

      toast({
        description: prompts.ui.child.toastSelected(data.name),
      });
    } catch (error) {
      console.error('Error adding child:', error);
      toast({
        title: 'Error',
        description: 'Failed to add child. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <div className="flex items-center space-x-2">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      <span className="text-sm text-muted-foreground">Loading children...</span>
    </div>;
  }

  return (
    <div className="space-y-4">
      {children.length > 0 && (
        <div>
          <Label htmlFor="child-select">{prompts.ui.child.label}</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">{prompts.ui.child.helper('Blackhawk')}</p>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder={prompts.ui.child.ph} />
            </SelectTrigger>
            <SelectContent>
              {children.map((child) => (
                <SelectItem key={child.id} value={child.id}>
                  <div className="flex items-center space-x-2">
                    <User className="h-4 w-4" />
                    <span>{child.name}</span>
                    {child.dob && (
                      <span className="text-xs text-muted-foreground">
                        (DOB: {new Date(child.dob).toLocaleDateString()})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!showAddForm && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowAddForm(true)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New Child
        </Button>
      )}

      {showAddForm && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label htmlFor="child-name">Name *</Label>
              <Input
                id="child-name"
                value={newChild.name}
                onChange={(e) => setNewChild(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter child's name"
              />
            </div>
            <div>
              <Label htmlFor="child-dob">Date of Birth (Optional)</Label>
              <Input
                id="child-dob"
                type="date"
                value={newChild.dob}
                onChange={(e) => setNewChild(prev => ({ ...prev, dob: e.target.value }))}
              />
            </div>
            <div className="flex space-x-2">
              <Button
                onClick={addChild}
                disabled={adding}
                className="flex-1"
              >
                {adding ? 'Adding...' : 'Add Child'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddForm(false);
                  setNewChild({ name: '', dob: '' });
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}