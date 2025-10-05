import { useEffect } from 'react';
import { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedDiscoveredField } from '@/components/FieldRenderer';

interface PriceOption {
  value: string;
  label: string;
  costCents: number | null;
}

interface FieldWithPrice extends EnhancedDiscoveredField {
  isPriceBearing?: boolean;
  priceOptions?: PriceOption[];
}

interface SmartDefaultsProps<T> {
  fields: EnhancedDiscoveredField[];
  childId: string;
  setValue: UseFormSetValue<T>;
  watch: UseFormWatch<T>;
}

// Helper to detect price signals in option labels
const MONEY_RE = /(?:\$|USD|US\$|£|€)\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/i;
const FREE_WORDS = /\b(free|no charge|included|no cost|\$0)\b/i;
const PLACEHOLDER_RE = /^\s*(--?\s*)?(select|choose|please select)[\s-]*--?\s*$/i;

function labelToCents(label: string): number | null {
  if (FREE_WORDS.test(label)) return 0;
  
  const moneyLike = label.match(MONEY_RE)?.[0] ?? null;
  if (!moneyLike) return null;
  
  const numMatch = moneyLike.match(/\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/);
  if (!numMatch) return null;
  
  const normalized = numMatch[0].replace(/[,\s]/g, '');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function annotateFieldPrice(field: EnhancedDiscoveredField): FieldWithPrice {
  const isChoice = field.type === 'select' || field.type === 'radio';
  if (!isChoice || !field.options?.length) return field;

  const priceOptions: PriceOption[] = field.options.map(opt => ({
    value: opt,
    label: opt,
    costCents: labelToCents(opt ?? ''),
  }));

  const hasAnyPriceSignal = priceOptions.some(o => o.costCents !== null);
  return {
    ...field,
    isPriceBearing: hasAnyPriceSignal,
    priceOptions: hasAnyPriceSignal ? priceOptions : undefined,
  };
}

function chooseSmartDefault(field: FieldWithPrice): string | undefined {
  const opts = field.options ?? [];
  if (!opts.length) return undefined;

  // Price-bearing? Prefer $0
  if (field.isPriceBearing && field.priceOptions?.length) {
    const freeOpt = field.priceOptions.find(o => o.costCents === 0);
    if (freeOpt) return freeOpt.value;
    
    // No explicit $0—fallback to lowest cost
    const cheapest = [...field.priceOptions].sort((a, b) =>
      (a.costCents ?? 0) - (b.costCents ?? 0)
    )[0];
    if (cheapest) return cheapest.value;
  }

  // Non-price-bearing: pick first *real* option (skip placeholders/empty)
  const real = opts.find(o => {
    if (typeof o === 'string') {
      return o?.trim() && !PLACEHOLDER_RE.test(o) && o.toLowerCase() !== 'none';
    } else {
      return o?.value?.trim() && !PLACEHOLDER_RE.test(o.label ?? '') && o.value.toLowerCase() !== 'none';
    }
  });
  if (typeof real === 'string') {
    return real;
  } else if (real && typeof real === 'object') {
    return (real as { value: string }).value;
  }
  return typeof opts[0] === 'string' ? opts[0] : (opts[0] as { value: string })?.value;
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

          // Select/Radio fields - PRICE-AWARE LOGIC
          if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
            const fieldLower = field.label.toLowerCase();
            
            // First, annotate the field with price information
            const annotatedField = annotateFieldPrice(field);
            
            // Then choose the smart default
            const smartDefault = chooseSmartDefault(annotatedField);
            
            if (smartDefault) {
              setValue(`answers.${field.id}` as any, smartDefault as any);
              
              // Log for debugging
              if (annotatedField.isPriceBearing) {
                const selected = annotatedField.priceOptions?.find(o => o.value === smartDefault);
                console.log(`[SmartDefaults] Price-aware default for "${field.label}": "${selected?.label}" (${selected?.costCents} cents)`);
              }
            }
            
            // Legacy fallbacks for specific field types (if no price logic applied)
            if (!smartDefault) {
              // Default skill level to beginner if available
              if (fieldLower.includes('skill') || fieldLower.includes('level')) {
                const beginnerOption = field.options.find(opt => {
                  const val = typeof opt === 'string' ? opt : opt.value;
                  return val.toLowerCase().includes('beginner') || 
                         val.toLowerCase().includes('first time') ||
                         val.toLowerCase().includes('never');
                });
                if (beginnerOption) {
                  const value = typeof beginnerOption === 'string' ? beginnerOption : beginnerOption.value;
                  setValue(`answers.${field.id}` as any, value as any);
                }
              }

              // Default gender if available and can be determined
              if (fieldLower.includes('gender') || fieldLower.includes('sex')) {
                // Don't auto-set gender - let parents choose
              }

              // Default emergency contact relationship
              if (fieldLower.includes('relationship') && fieldLower.includes('emergency')) {
                const parentOption = field.options.find(opt => {
                  const val = typeof opt === 'string' ? opt : opt.value;
                  return val.toLowerCase().includes('parent') || 
                         val.toLowerCase().includes('mother') || 
                         val.toLowerCase().includes('father');
                });
                if (parentOption) {
                  const value = typeof parentOption === 'string' ? parentOption : parentOption.value;
                  setValue(`answers.${field.id}` as any, value as any);
                }
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