import { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AutoAnsweredQuestion {
  label: string;
  answer: string;
  reason: string;
}

interface ProgramQuestionsAutoAnsweredProps {
  questions: AutoAnsweredQuestion[];
}

export function ProgramQuestionsAutoAnswered({ questions }: ProgramQuestionsAutoAnsweredProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CheckCircle className="h-5 w-5 text-success" />
          Program Questions Auto-Answered
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-background/50">
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">We detected additional program questions that will be answered automatically using these rules:</p>
            <ul className="space-y-1 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                <span>Always choose free ($0) options when available</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                <span>Select "None" or basic options to minimize cost</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                <span>Skip optional add-ons unless they're free</span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground mt-3">
              If any required questions cannot be auto-answered, you'll be notified before signup.
            </p>
          </AlertDescription>
        </Alert>

        {questions.length > 0 && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span>View Auto-Selected Answers ({questions.length})</span>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 mt-4">
              {questions.map((q, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-background border border-border">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-medium text-sm">{q.label}</p>
                    <Badge variant="secondary" className="text-xs">Auto-Selected</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    <span className="font-medium">Answer:</span> {q.answer}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Why:</span> {q.reason}
                  </p>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
