import { useEffect, useState, useRef } from 'react';
import { UseFormWatch, UseFormSetValue } from 'react-hook-form';
import { Save, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { RegistrationFormData } from '@/types/forms';

interface DraftSaverProps<T> {
  formData: T;
  watch: UseFormWatch<T>;
  setValue: UseFormSetValue<T>;
  draftKey: string;
  triggerReload?: number;
}

export function DraftSaver<T>({ formData, watch, setValue, draftKey, triggerReload }: DraftSaverProps<T>) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const { toast } = useToast();
  
  // Use ref to capture latest formData without triggering interval recreation
  const formDataRef = useRef(formData);
  
  // Update ref whenever formData changes
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

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
  }, [hasUnsavedChanges]);

  // Load draft on mount AND when triggerReload changes
  useEffect(() => {
    loadDraft();
  }, [triggerReload]);

  const saveDraft = () => {
    try {
      const currentFormData = formDataRef.current;
      const draftData = {
        data: currentFormData,
        timestamp: new Date().toISOString(),
      };
      
      const formDataTyped = currentFormData as Partial<RegistrationFormData>;
      console.log('[DraftSaver] 💾 SAVING draft:', {
        opensAt: formDataTyped.opensAt,
        opensAtType: typeof formDataTyped.opensAt,
        maxAmountCents: formDataTyped.maxAmountCents,
        contactPhone: formDataTyped.contactPhone,
        prereqComplete: formDataTyped.prereqComplete,
      });
      
      localStorage.setItem(`plan_draft_${draftKey}`, JSON.stringify(draftData));
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      
      console.log('[DraftSaver] ✅ Save complete');
    } catch (error) {
      console.error('[DraftSaver] ❌ Failed to save draft:', error);
    }
  };

  const loadDraft = () => {
    try {
      const savedDraft = localStorage.getItem(`plan_draft_${draftKey}`);
      
      console.log('[DraftSaver] 🔍 RELOAD TRIGGERED:', {
        triggerReload,
        hasDraft: !!savedDraft,
        timestamp: new Date().toISOString()
      });
      
      if (savedDraft) {
        const { data, timestamp } = JSON.parse(savedDraft);
        const savedDate = new Date(timestamp);
        
        // 📊 Log EVERYTHING from localStorage
        console.log('[DraftSaver] 📦 Raw data from localStorage:', {
          opensAt: data.opensAt,
          opensAtType: typeof data.opensAt,
          opensAtIsDate: data.opensAt instanceof Date,
          maxAmountCents: data.maxAmountCents,
          maxAmountCentsType: typeof data.maxAmountCents,
          contactPhone: data.contactPhone,
          contactPhoneType: typeof data.contactPhone,
          prereqComplete: data.prereqComplete,
          prereqCompleteType: typeof data.prereqComplete,
          allKeys: Object.keys(data),
          savedDate
        });
        
        // Only load if saved within last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        if (savedDate > weekAgo) {
          console.log('[DraftSaver] ✅ Draft is recent, loading values...');
          
          // Set form values from draft with proper type conversion
          Object.entries(data).forEach(([key, value]) => {
            if (key === 'answers' && typeof value === 'object' && value !== null) {
              console.log('[DraftSaver] 📝 Loading nested answers:', Object.keys(value));
              Object.entries(value).forEach(([answerKey, answerValue]) => {
                setValue(`answers.${answerKey}` as any, answerValue as any);
              });
            } else if (key === 'opensAt' && typeof value === 'string') {
              // 🔧 FIX: Convert ISO string back to Date object
              try {
                const dateValue = new Date(value);
                if (!isNaN(dateValue.getTime())) {
                  console.log('[DraftSaver] 📅 Converting opensAt:', {
                    from: value,
                    fromType: typeof value,
                    to: dateValue,
                    toType: typeof dateValue,
                    isValidDate: !isNaN(dateValue.getTime())
                  });
                  setValue('opensAt' as any, dateValue as any);
                } else {
                  console.error('[DraftSaver] ❌ Invalid date string:', value);
                }
              } catch (error) {
                console.error('[DraftSaver] ❌ Failed to parse date:', error);
              }
            } else {
              console.log(`[DraftSaver] 📝 Loading ${key}:`, {
                value,
                type: typeof value,
                isNull: value === null,
                isUndefined: value === undefined
              });
              setValue(key as any, value as any, {
                shouldValidate: true,
                shouldDirty: true,
                shouldTouch: true
              });
            }
          });
          
          setLastSaved(savedDate);
          
          console.log('[DraftSaver] ✅ RELOAD COMPLETE - All values set');
          
          toast({
            title: 'Draft Loaded',
            description: `Restored your progress from ${savedDate.toLocaleDateString()}`,
          });
        } else {
          console.log('[DraftSaver] ⏰ Draft is too old, ignoring');
        }
      } else {
        console.log('[DraftSaver] 📭 No draft found in localStorage');
      }
    } catch (error) {
      console.error('[DraftSaver] ❌ Failed to load draft:', error);
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