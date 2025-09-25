import { useState } from 'react';
import { Control, FieldValues, UseFormWatch } from 'react-hook-form';
import { ChevronDown, ChevronRight, CheckCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FieldRenderer, EnhancedDiscoveredField } from './FieldRenderer';

interface FieldGroupProps<T extends FieldValues> {
  title: string;
  description?: string;
  fields: EnhancedDiscoveredField[];
  control: Control<T>;
  watch: UseFormWatch<T>;
  defaultOpen?: boolean;
  category: string;
}

const categoryIcons = {
  child_info: '👶',
  program_selection: '⛷️',
  legal_waivers: '📄',
  emergency_contacts: '🚨',
  payment_preferences: '💳',
};

const categoryColors = {
  child_info: 'bg-blue-50 border-blue-200',
  program_selection: 'bg-green-50 border-green-200',
  legal_waivers: 'bg-yellow-50 border-yellow-200',
  emergency_contacts: 'bg-red-50 border-red-200',
  payment_preferences: 'bg-purple-50 border-purple-200',
};

export function FieldGroup<T extends FieldValues>({
  title,
  description,
  fields,
  control,
  watch,
  defaultOpen = false,
  category,
}: FieldGroupProps<T>) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Calculate completion progress
  const getFieldValue = (fieldId: string) => {
    return watch(`answers.${fieldId}` as any);
  };

  const requiredFields = fields.filter(f => f.required);
  const completedRequiredFields = requiredFields.filter(f => {
    const value = getFieldValue(f.id);
    return value && value !== '';
  });

  const optionalFields = fields.filter(f => !f.required);
  const completedOptionalFields = optionalFields.filter(f => {
    const value = getFieldValue(f.id);
    return value && value !== '';
  });

  const totalFields = fields.length;
  const completedFields = completedRequiredFields.length + completedOptionalFields.length;
  const progress = totalFields > 0 ? (completedFields / totalFields) * 100 : 0;

  const isComplete = requiredFields.length > 0 && completedRequiredFields.length === requiredFields.length;

  return (
    <Card className={cn('transition-all duration-200', categoryColors[category as keyof typeof categoryColors] || 'bg-gray-50 border-gray-200')}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-background/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">
                  {categoryIcons[category as keyof typeof categoryIcons] || '📋'}
                </span>
                <div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  {description && (
                    <p className="text-sm text-muted-foreground mt-1">{description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {isComplete ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Complete
                  </Badge>
                ) : completedFields > 0 ? (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                    <Clock className="w-3 h-3 mr-1" />
                    {completedFields}/{totalFields}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    {totalFields} fields
                  </Badge>
                )}
                <Button variant="ghost" size="sm">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {totalFields > 0 && (
              <div className="mt-2">
                <Progress value={progress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{completedFields} of {totalFields} completed</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </div>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {requiredFields.length > 0 && (
              <>
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                    Required Fields
                  </h4>
                  {requiredFields.map((field) => (
                    <FieldRenderer
                      key={field.id}
                      field={field}
                      control={control}
                      watch={watch}
                      fieldName={`answers.${field.id}` as any}
                    />
                  ))}
                </div>
              </>
            )}
            
            {optionalFields.length > 0 && (
              <>
                {requiredFields.length > 0 && <div className="border-t pt-4" />}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                    Optional Fields
                  </h4>
                  {optionalFields.map((field) => (
                    <FieldRenderer
                      key={field.id}
                      field={field}
                      control={control}
                      watch={watch}
                      fieldName={`answers.${field.id}` as any}
                    />
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}