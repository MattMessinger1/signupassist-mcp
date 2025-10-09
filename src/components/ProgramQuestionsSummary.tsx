import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

interface ProgramAnswer {
  id: string;
  question: string;
  answer: string;
}

const PROGRAM_ANSWERS: ProgramAnswer[] = [
  { id: 'color', question: 'Color Group', answer: 'Red Group' },
  { id: 'rentals', question: 'Equipment Rentals', answer: 'None' },
  { id: 'volunteer', question: 'Volunteer Preference', answer: 'Instructor' },
];

export function ProgramQuestionsSummary() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          Program Questions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {PROGRAM_ANSWERS.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">{item.question}</div>
                <div className="text-sm text-muted-foreground">{item.answer}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
