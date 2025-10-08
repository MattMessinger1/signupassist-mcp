import { useState } from 'react';
import { Control, FieldValues, Path, UseFormWatch } from 'react-hook-form';
import { CalendarIcon, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface PriceOption {
  value: string;
  label: string;
  costCents: number | null;
}

export interface EnhancedDiscoveredField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'number' | 'date' | 'checkbox' | 'radio' | 'file' | 'multi-select';
  required: boolean;
  options?: string[] | Array<{ value: string; label?: string }>;
  category?: 'child_info' | 'program_selection' | 'legal_waivers' | 'emergency_contacts' | 'payment_preferences';
  placeholder?: string;
  description?: string;
  dependsOn?: string; // Field ID that this field depends on
  showWhen?: string; // Value of the dependent field that shows this field
  isPriceBearing?: boolean;
  priceOptions?: PriceOption[];
}

interface FieldRendererProps<T extends FieldValues> {
  field: EnhancedDiscoveredField;
  control: Control<T>;
  watch: UseFormWatch<T>;
  fieldName: Path<T>;
}

export function FieldRenderer<T extends FieldValues>({
  field,
  control,
  watch,
  fieldName,
}: FieldRendererProps<T>) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Check if field should be shown based on dependencies
  const shouldShow = () => {
    if (!field.dependsOn || !field.showWhen) return true;
    const dependentValue = watch(`answers.${field.dependsOn}` as Path<T>);
    return dependentValue === field.showWhen;
  };

  if (!shouldShow()) return null;

  return (
    <FormField
      control={control}
      name={fieldName}
      render={({ field: formField }) => (
        <FormItem>
          <FormLabel>
            {field.label} {field.required && <span className="text-destructive">*</span>}
          </FormLabel>
          <FormControl>
            {(() => {
              switch (field.type) {
                case 'select':
                  return (
                    <Select value={formField.value} onValueChange={formField.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}...`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((option) => {
                          const optValue = typeof option === 'string' ? option : option.value;
                          const optLabel = typeof option === 'string' ? option : (option.label || option.value);
                          return (
                            <SelectItem key={optValue} value={optValue}>
                              {optLabel}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  );

                case 'multi-select':
                  return (
                    <div className="space-y-2">
                      {field.options?.map((option) => {
                        const optValue = typeof option === 'string' ? option : option.value;
                        const optLabel = typeof option === 'string' ? option : (option.label || option.value);
                        return (
                          <div key={optValue} className="flex items-center space-x-2">
                            <Checkbox
                              id={`${field.id}-${optValue}`}
                              checked={formField.value?.includes(optValue) || false}
                              onCheckedChange={(checked) => {
                                const currentValue = formField.value || [];
                                if (checked) {
                                  formField.onChange([...currentValue, optValue]);
                                } else {
                                  formField.onChange(currentValue.filter((v: string) => v !== optValue));
                                }
                              }}
                            />
                            <Label htmlFor={`${field.id}-${optValue}`}>{optLabel}</Label>
                          </div>
                        );
                      })}
                    </div>
                  );

                case 'radio':
                  return (
                    <RadioGroup value={formField.value} onValueChange={formField.onChange}>
                      {field.options?.map((option) => {
                        const optValue = typeof option === 'string' ? option : option.value;
                        const optLabel = typeof option === 'string' ? option : (option.label || option.value);
                        return (
                          <div key={optValue} className="flex items-center space-x-2">
                            <RadioGroupItem value={optValue} id={`${field.id}-${optValue}`} />
                            <Label htmlFor={`${field.id}-${optValue}`}>{optLabel}</Label>
                          </div>
                        );
                      })}
                    </RadioGroup>
                  );

                case 'date':
                  return (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !formField.value && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formField.value ? format(new Date(formField.value), "PPP") : (
                            <span>{field.placeholder || "Pick a date"}</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={formField.value ? new Date(formField.value) : undefined}
                          onSelect={(date) => formField.onChange(date?.toISOString())}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  );

                case 'file':
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = '*/*';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) {
                                setUploadedFile(file);
                                formField.onChange(file.name);
                              }
                            };
                            input.click();
                          }}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Choose File
                        </Button>
                        {uploadedFile && (
                          <span className="text-sm text-muted-foreground">
                            {uploadedFile.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        File will be uploaded during signup process
                      </p>
                    </div>
                  );

                case 'textarea':
                  return (
                    <Textarea 
                      {...formField} 
                      placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    />
                  );

                case 'number':
                  return (
                    <Input 
                      {...formField} 
                      type="number" 
                      placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    />
                  );

                case 'checkbox':
                  return (
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={formField.value || false}
                        onCheckedChange={formField.onChange}
                      />
                      <Label>{field.description || 'Check to confirm'}</Label>
                    </div>
                  );

                default:
                  return (
                    <Input 
                      {...formField} 
                      placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    />
                  );
              }
            })()}
          </FormControl>
          {field.description && field.type !== 'checkbox' && (
            <p className="text-sm text-muted-foreground">{field.description}</p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}