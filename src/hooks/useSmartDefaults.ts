import { useEffect } from 'react';
import { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedDiscoveredField } from '@/components/FieldRenderer';

interface SmartDefaultsProps<T> {
  fields: EnhancedDiscoveredField[];
  childId: string;
  setValue: UseFormSetValue<T>;
  watch: UseFormWatch<T>;
}

export function useSmartDefaults<T>({ fields, childId, setValue, watch }: SmartDefaultsProps<T>) {
  useEffect(() => {
    if (!childId || !fields.length) return;

    const applySmartDefaults = async () => {
      try {
        // Get child information
        const { data: child } = await supabase
          .from('children')
          .select('*')
          .eq('id', childId)
          .single();

        if (!child) return;

        // Apply smart defaults based on field types and child data
        fields.forEach((field) => {
          const currentValue = watch(`answers.${field.id}` as any);
          
          // Only set defaults if field is empty
          if (currentValue) return;

          // Date fields - try to populate with child's DOB if field suggests it
          if (field.type === 'date' && child.dob) {
            const fieldLower = field.label.toLowerCase();
            if (fieldLower.includes('birth') || fieldLower.includes('dob') || fieldLower.includes('date of birth')) {
              setValue(`answers.${field.id}` as any, child.dob as any);
            }
          }

          // Text fields - populate with child name if appropriate
          if (field.type === 'text') {
            const fieldLower = field.label.toLowerCase();
            if (fieldLower.includes('name') && fieldLower.includes('child')) {
              setValue(`answers.${field.id}` as any, child.name as any);
            }
          }

          // Checkbox fields - set common defaults
          if (field.type === 'checkbox') {
            const fieldLower = field.label.toLowerCase();
            
            // Auto-check common parent consent fields
            if (fieldLower.includes('parent') && fieldLower.includes('consent')) {
              setValue(`answers.${field.id}` as any, true as any);
            }
            
            // Auto-check photo release if it's a general one
            if (fieldLower.includes('photo') && fieldLower.includes('release') && !fieldLower.includes('no')) {
              setValue(`answers.${field.id}` as any, true as any);
            }
          }

          // Select fields - set reasonable defaults
          if (field.type === 'select' && field.options?.length) {
            const fieldLower = field.label.toLowerCase();
            
            // Default skill level to beginner if available
            if (fieldLower.includes('skill') || fieldLower.includes('level')) {
              const beginnerOption = field.options.find(opt => 
                opt.toLowerCase().includes('beginner') || 
                opt.toLowerCase().includes('first time') ||
                opt.toLowerCase().includes('never')
              );
              if (beginnerOption) {
                setValue(`answers.${field.id}` as any, beginnerOption as any);
              }
            }

            // Default gender if available and can be determined
            if (fieldLower.includes('gender') || fieldLower.includes('sex')) {
              // Don't auto-set gender - let parents choose
            }

            // Default emergency contact relationship
            if (fieldLower.includes('relationship') && fieldLower.includes('emergency')) {
              const parentOption = field.options.find(opt => 
                opt.toLowerCase().includes('parent') || 
                opt.toLowerCase().includes('mother') || 
                opt.toLowerCase().includes('father')
              );
              if (parentOption) {
                setValue(`answers.${field.id}` as any, parentOption as any);
              }
            }
          }
        });

      } catch (error) {
        console.error('Error applying smart defaults:', error);
      }
    };

    applySmartDefaults();
  }, [fields, childId, setValue, watch]);
}