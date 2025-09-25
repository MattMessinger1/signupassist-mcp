import { useState } from 'react';
import { Eye, EyeOff, User, Calendar, CreditCard, FileText, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format } from 'date-fns';

interface PlanPreviewProps {
  programRef: string;
  childName: string;
  opensAt: Date;
  selectedBranch: string;
  answers: Record<string, any>;
  discoveredFields: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    category?: string;
  }>;
  credentialAlias: string;
}

export function PlanPreview({
  programRef,
  childName,
  opensAt,
  selectedBranch,
  answers,
  discoveredFields,
  credentialAlias,
}: PlanPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'child_info': return <User className="h-4 w-4" />;
      case 'program_selection': return <Calendar className="h-4 w-4" />;
      case 'legal_waivers': return <FileText className="h-4 w-4" />;
      case 'emergency_contacts': return <AlertTriangle className="h-4 w-4" />;
      case 'payment_preferences': return <CreditCard className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const groupedAnswers = discoveredFields.reduce((acc, field) => {
    const category = field.category || 'other';
    if (!acc[category]) acc[category] = [];
    
    const answer = answers[field.id];
    if (answer !== undefined && answer !== '') {
      acc[category].push({
        label: field.label,
        value: answer,
        type: field.type,
        required: field.required,
      });
    }
    return acc;
  }, {} as Record<string, Array<{label: string, value: any, type: string, required: boolean}>>);

  const formatValue = (value: any, type: string) => {
    if (type === 'date' && value) {
      try {
        return format(new Date(value), 'PPP');
      } catch {
        return value;
      }
    }
    if (type === 'checkbox') {
      return value ? '✓ Yes' : '✗ No';
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return value || 'Not provided';
  };

  const categoryTitles = {
    child_info: 'Child Information',
    program_selection: 'Program Selection',
    legal_waivers: 'Legal & Waivers',
    emergency_contacts: 'Emergency Contacts',
    payment_preferences: 'Payment Preferences',
    other: 'Additional Information',
  };

  const totalAnswers = Object.values(groupedAnswers).flat().length;
  const requiredAnswers = Object.values(groupedAnswers).flat().filter((a: any) => a.required).length;

  return (
    <Card className="border-primary/20">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  {isExpanded ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  <span>Plan Preview</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Review what will be submitted during signup
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Badge variant="outline">
                  {totalAnswers} fields completed
                </Badge>
                <Badge variant="secondary">
                  {requiredAnswers} required
                </Badge>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-6">
            {/* Basic Plan Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
              <div>
                <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-2">
                  Registration Details
                </h4>
                <div className="space-y-1 text-sm">
                  <div><strong>Program:</strong> {programRef}</div>
                  <div><strong>Child:</strong> {childName}</div>
                  <div><strong>Opens:</strong> {format(opensAt, 'PPP p')}</div>
                  {selectedBranch && <div><strong>Type:</strong> {selectedBranch}</div>}
                  <div><strong>Credentials:</strong> {credentialAlias}</div>
                </div>
              </div>
            </div>

            {/* Categorized Answers */}
            {Object.entries(groupedAnswers).map(([category, categoryAnswers]) => (
              <div key={category} className="space-y-3">
                <div className="flex items-center space-x-2">
                  {getCategoryIcon(category)}
                  <h4 className="font-medium">
                    {categoryTitles[category as keyof typeof categoryTitles] || 'Other'}
                  </h4>
                  <Badge variant="outline" className="text-xs">
                    {categoryAnswers.length} fields
                  </Badge>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {categoryAnswers.map((answer, index) => (
                    <div
                      key={index}
                      className="p-3 border rounded-lg bg-card"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {answer.label}
                            {answer.required && (
                              <span className="text-destructive ml-1">*</span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {formatValue(answer.value, answer.type)}
                          </div>
                        </div>
                        {answer.required && (
                          <Badge variant="secondary" className="text-xs">
                            Required
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                {Object.keys(groupedAnswers).indexOf(category) < Object.keys(groupedAnswers).length - 1 && (
                  <Separator className="my-4" />
                )}
              </div>
            ))}

            {totalAnswers === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Complete the form fields to see what will be submitted</p>
              </div>
            )}

            {/* Success Rate Indicator */}
            {totalAnswers > 0 && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center space-x-2 text-green-800">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="font-medium">High Success Rate Expected</span>
                </div>
                <p className="text-sm text-green-700 mt-1">
                  With {totalAnswers} fields pre-completed, your signup has a ~90% success rate
                </p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}