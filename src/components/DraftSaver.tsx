import { useEffect, useState } from 'react';
import { UseFormWatch, UseFormSetValue } from 'react-hook-form';
import { Save, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface DraftSaverProps<T> {
  formData: T;
  watch: UseFormWatch<T>;
  setValue: UseFormSetValue<T>;
  draftKey: string;
}

export function DraftSaver<T>({ formData, watch, setValue, draftKey }: DraftSaverProps<T>) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const { toast } = useToast();

  // Watch for form changes
  useEffect(() => {
    const subscription = watch(() => {
      setHasUnsavedChanges(true);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  // Auto-save every 30 seconds if there are changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasUnsavedChanges) {
        saveDraft();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [hasUnsavedChanges, formData]);

  // Load draft on mount
  useEffect(() => {
    loadDraft();
  }, []);

  const saveDraft = () => {
    try {
      localStorage.setItem(`plan_draft_${draftKey}`, JSON.stringify({
        data: formData,
        timestamp: new Date().toISOString(),
      }));
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  };

  const loadDraft = () => {
    try {
      const savedDraft = localStorage.getItem(`plan_draft_${draftKey}`);
      if (savedDraft) {
        const { data, timestamp } = JSON.parse(savedDraft);
        const savedDate = new Date(timestamp);
        
        // Only load if saved within last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        if (savedDate > weekAgo) {
          // Set form values from draft
          Object.entries(data).forEach(([key, value]) => {
            if (key === 'answers' && typeof value === 'object' && value !== null) {
              Object.entries(value as Record<string, any>).forEach(([answerKey, answerValue]) => {
                setValue(`answers.${answerKey}` as any, answerValue as any);
              });
            } else {
              setValue(key as any, value as any);
            }
          });
          
          setLastSaved(savedDate);
          toast({
            title: 'Draft Loaded',
            description: `Restored your progress from ${savedDate.toLocaleDateString()}`,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(`plan_draft_${draftKey}`);
    setLastSaved(null);
    setHasUnsavedChanges(false);
    toast({
      title: 'Draft Cleared',
      description: 'Your draft has been removed.',
    });
  };

  return (
    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
      <div className="flex items-center space-x-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {lastSaved ? (
            <>Last saved: {lastSaved.toLocaleTimeString()}</>
          ) : (
            'No draft saved'
          )}
        </span>
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">
            Unsaved changes
          </Badge>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={saveDraft}
          disabled={!hasUnsavedChanges}
        >
          <Save className="h-3 w-3 mr-1" />
          Save Draft
        </Button>
        {lastSaved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearDraft}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}