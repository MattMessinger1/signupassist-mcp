import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export interface ProgramQuestion {
  id: string;
  label: string;
  type: 'text' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'date';
  options?: string[];
  required?: boolean;
  description?: string;
}

export interface ProgramQuestionsPanelProps {
  questions: ProgramQuestion[];
  initialAnswers?: Record<string, string | boolean>;
  onSubmit?: (answers: Record<string, string | boolean>) => void;
  onBack?: () => void;
  onRecheck?: () => void;
  isSubmitting?: boolean;
  isRechecking?: boolean;
}

export default function ProgramQuestionsPanel({
  questions,
  initialAnswers = {},
  onSubmit,
  onBack,
  onRecheck,
  isSubmitting = false,
  isRechecking = false,
}: ProgramQuestionsPanelProps) {
  // Build dynamic Zod schema based on questions
  const schema = useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};

    questions.forEach((question) => {
      let fieldSchema: z.ZodTypeAny;

      switch (question.type) {
        case 'text':
        case 'textarea':
          if (question.required) {
            fieldSchema = z
              .string()
              .trim()
              .min(1, `${question.label} is required`)
              .max(1000, 'Answer must be less than 1000 characters');
          } else {
            fieldSchema = z
              .string()
              .trim()
              .max(1000, 'Answer must be less than 1000 characters')
              .optional();
          }
          break;

        case 'select':
        case 'radio':
          if (question.options && question.options.length > 0) {
            fieldSchema = z.enum(question.options as [string, ...string[]]);
            if (!question.required) {
              fieldSchema = fieldSchema.optional();
            }
          } else {
            fieldSchema = z.string().optional();
          }
          break;

        case 'checkbox':
          fieldSchema = z.boolean();
          if (question.required) {
            fieldSchema = fieldSchema.refine((val) => val === true, {
              message: `${question.label} must be checked`,
            });
          } else {
            fieldSchema = fieldSchema.optional();
          }
          break;

        case 'date':
          fieldSchema = z.date();
          if (!question.required) {
            fieldSchema = fieldSchema.optional();
          }
          break;

        default:
          fieldSchema = z.string().optional();
      }

      shape[question.id] = fieldSchema;
    });

    return z.object(shape);
  }, [questions]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: initialAnswers,
  });

  // Update form when initial answers change
  useEffect(() => {
    Object.entries(initialAnswers).forEach(([key, value]) => {
      setValue(key, value);
    });
  }, [initialAnswers, setValue]);

  const onFormSubmit = (data: any) => {
    if (onSubmit) {
      onSubmit(data);
    }
  };

  if (questions.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 max-w-4xl mx-auto"
    >
      <div>
        <h2 className="text-2xl font-bold mb-2">Program-Specific Questions</h2>
        <p className="text-muted-foreground">
          Answer these to complete registration.
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {questions.map((question, index) => (
              <motion.div
                key={question.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  'space-y-2',
                  question.type === 'textarea' && 'md:col-span-2'
                )}
              >
                <Label htmlFor={question.id} className="text-sm font-medium">
                  {question.label}
                  {question.required && (
                    <span className="text-red-600 ml-1">*</span>
                  )}
                </Label>

                {question.description && (
                  <p className="text-sm text-muted-foreground">
                    {question.description}
                  </p>
                )}

                {/* Text Input */}
                {question.type === 'text' && (
                  <Input
                    id={question.id}
                    {...register(question.id)}
                    className={cn(
                      errors[question.id] &&
                        'border-red-300 bg-red-50 dark:bg-red-950/20 focus-visible:ring-red-500'
                    )}
                    placeholder={`Enter ${question.label.toLowerCase()}`}
                  />
                )}

                {/* Textarea */}
                {question.type === 'textarea' && (
                  <Textarea
                    id={question.id}
                    {...register(question.id)}
                    className={cn(
                      'min-h-[100px]',
                      errors[question.id] &&
                        'border-red-300 bg-red-50 dark:bg-red-950/20 focus-visible:ring-red-500'
                    )}
                    placeholder={`Enter ${question.label.toLowerCase()}`}
                  />
                )}

                {/* Select Dropdown */}
                {question.type === 'select' && question.options && (
                  <Select
                    onValueChange={(value) => setValue(question.id, value)}
                    defaultValue={watch(question.id) as string}
                  >
                    <SelectTrigger
                      id={question.id}
                      className={cn(
                        'bg-background',
                        errors[question.id] &&
                          'border-red-300 bg-red-50 dark:bg-red-950/20'
                      )}
                    >
                      <SelectValue placeholder={`Select ${question.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      {question.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Radio Group */}
                {question.type === 'radio' && question.options && (
                  <RadioGroup
                    onValueChange={(value) => setValue(question.id, value)}
                    defaultValue={watch(question.id) as string}
                    className={cn(
                      'space-y-2',
                      errors[question.id] &&
                        'p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20'
                    )}
                  >
                    {question.options.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`${question.id}-${option}`} />
                        <Label
                          htmlFor={`${question.id}-${option}`}
                          className="font-normal cursor-pointer"
                        >
                          {option}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}

                {/* Checkbox */}
                {question.type === 'checkbox' && (
                  <div
                    className={cn(
                      'flex items-start space-x-2 p-3 rounded-lg border',
                      errors[question.id]
                        ? 'border-red-300 bg-red-50 dark:bg-red-950/20'
                        : 'border-border'
                    )}
                  >
                    <Checkbox
                      id={question.id}
                      checked={watch(question.id) as boolean}
                      onCheckedChange={(checked) =>
                        setValue(question.id, checked as boolean)
                      }
                    />
                    <Label
                      htmlFor={question.id}
                      className="font-normal cursor-pointer leading-tight"
                    >
                      I agree to {question.label.toLowerCase()}
                    </Label>
                  </div>
                )}

                {/* Date Picker */}
                {question.type === 'date' && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !watch(question.id) && 'text-muted-foreground',
                          errors[question.id] &&
                            'border-red-300 bg-red-50 dark:bg-red-950/20'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {watch(question.id) && typeof watch(question.id) === 'object'
                          ? format(watch(question.id) as any, 'PPP')
                          : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-background z-50" align="start">
                      <Calendar
                        mode="single"
                        selected={typeof watch(question.id) === 'object' ? watch(question.id) as any : undefined}
                        onSelect={(date) => setValue(question.id, date as any)}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                )}

                {/* Error Message */}
                {errors[question.id] && (
                  <div className="flex items-center gap-1 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>{errors[question.id]?.message as string}</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 justify-between pt-4 border-t">
            <div className="flex gap-3">
              {onBack && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={onBack}
                  disabled={isSubmitting || isRechecking}
                  aria-label="Return to prerequisites"
                  className="w-full sm:w-auto min-w-[160px]"
                >
                  Back to Prerequisites
                </Button>
              )}
              {onRecheck && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={onRecheck}
                  disabled={isSubmitting || isRechecking}
                  aria-label="Recheck program questions"
                  className="w-full sm:w-auto min-w-[140px]"
                >
                  {isRechecking ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Rechecking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Recheck
                    </>
                  )}
                </Button>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={!isValid || isSubmitting || isRechecking}
              aria-label="Save program answers"
              className="w-full sm:w-auto min-w-[200px]"
            >
              {isSubmitting ? 'Saving...' : 'Save Answers'}
            </Button>
          </div>
        </form>
      </Card>
    </motion.div>
  );
}
