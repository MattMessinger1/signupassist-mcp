/**
 * PrereqChecklistCard Component
 * 
 * Dynamically renders program prerequisites and questions in a structured card format.
 * Displays:
 * - Prerequisites section (membership, waiver, payment, child info)
 * - Questions section (color group, rentals, medical, etc.)
 * - CTA button to proceed with registration
 * 
 * Part of Phase 1C: Cache-first checklist flow
 */

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

export interface PrereqField {
  required: boolean;
  check: string;
  message: string;
}

export interface QuestionField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  helper_text?: string;
  isPriceBearing?: boolean;
}

export interface PrereqChecklistCardProps {
  title: string;
  program_ref: string;
  prerequisites: {
    [checkName: string]: PrereqField;
  };
  questions: QuestionField[];
  deep_link?: string;
  onAction?: (action: string, payload: any) => void;
}

/**
 * Renders a single prerequisite item with icon and message
 */
function PrerequisiteItem({ prereq }: { prereq: PrereqField }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {prereq.required ? (
        <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
      ) : (
        <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
      )}
      <div className="flex-1">
        <p className="text-sm text-foreground">{prereq.message}</p>
        {prereq.required && (
          <Badge variant="outline" className="mt-1 text-xs">
            Required
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a single question field with type indicator
 */
function QuestionItem({ question }: { question: QuestionField }) {
  const typeDisplay = {
    select: "Dropdown",
    checkbox: "Checkbox",
    text: "Text Input",
    textarea: "Text Area",
    date: "Date",
    number: "Number"
  }[question.type] || question.type;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{question.label}</p>
          {question.required && (
            <Badge variant="secondary" className="text-xs">
              Required
            </Badge>
          )}
          {question.isPriceBearing && (
            <Badge variant="outline" className="text-xs border-primary/50">
              Affects Price
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Type: {typeDisplay}
          {question.options && ` • ${question.options.length} options`}
        </p>
        {question.helper_text && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            {question.helper_text}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Main PrereqChecklistCard component
 */
export function PrereqChecklistCard({
  title,
  program_ref,
  prerequisites,
  questions,
  deep_link,
  onAction
}: PrereqChecklistCardProps) {
  const prereqEntries = Object.entries(prerequisites);
  const hasPrereqs = prereqEntries.length > 0;
  const hasQuestions = questions.length > 0;
  const requiredQuestions = questions.filter(q => q.required);

  const handleProceed = () => {
    if (onAction) {
      onAction('show_finish_options', { program_ref });
    }
  };

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>
          Review requirements before registration
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Prerequisites Section */}
        {hasPrereqs && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-primary" />
              Prerequisites
            </h3>
            <div className="space-y-1 bg-muted/50 rounded-lg p-3">
              {prereqEntries.map(([key, value]) => (
                <PrerequisiteItem key={key} prereq={value} />
              ))}
            </div>
          </div>
        )}

        {/* Questions Section */}
        {hasQuestions && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-primary" />
              Questions to Answer
              {requiredQuestions.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-auto">
                  {requiredQuestions.length} Required
                </Badge>
              )}
            </h3>
            <div className="space-y-0 bg-muted/50 rounded-lg p-3">
              {questions.map((question) => (
                <QuestionItem key={question.id} question={question} />
              ))}
            </div>
          </div>
        )}

        {!hasPrereqs && !hasQuestions && (
          <div className="text-center py-6 text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No specific requirements listed for this program.</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pt-4 border-t">
        <Button
          onClick={handleProceed}
          variant="default"
          className="w-full"
          size="lg"
        >
          Ready to Proceed
        </Button>
        {deep_link && (
          <Button
            onClick={() => window.open(deep_link, '_blank')}
            variant="outline"
            className="w-full"
            size="sm"
          >
            Open Provider Website
          </Button>
        )}
        <p className="text-xs text-muted-foreground text-center mt-2">
          You can complete registration on the provider's site or let SignupAssist handle it
        </p>
      </CardFooter>
    </Card>
  );
}
