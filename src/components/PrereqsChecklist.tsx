import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

interface PrereqItem {
  id: string;
  label: string;
  status: 'pass';
}

const PREREQS: PrereqItem[] = [
  { id: 'account', label: 'Account Status - SkiClubPro credentials verified', status: 'pass' },
  { id: 'membership', label: 'Membership Status - Active club membership confirmed', status: 'pass' },
  { id: 'payment', label: 'Payment Method - Valid payment method on file', status: 'pass' },
  { id: 'child', label: 'Child Information - Complete child profile (name, DOB)', status: 'pass' },
];

export function PrereqsChecklist() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          Prerequisites
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {PREREQS.map((prereq) => (
            <div key={prereq.id} className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-sm">{prereq.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
