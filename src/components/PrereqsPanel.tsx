import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';

interface Props {
  orgRef: string;
  credentialId: string;
  onChildSelected?: (childName: string) => void;
  onReadyToContinue?: () => void;
}

interface ManualPrereq {
  id: string;
  label: string;
  description: string;
  checked: boolean;
}

export default function PrerequisitesPanel({ onReadyToContinue }: Props) {
  const [prereqs, setPrereqs] = useState<ManualPrereq[]>([
    {
      id: 'account',
      label: 'Account Active',
      description: 'Your account is active and in good standing',
      checked: false
    },
    {
      id: 'membership',
      label: 'Membership Current',
      description: 'Your membership is current and valid',
      checked: false
    },
    {
      id: 'payment',
      label: 'Payment Method',
      description: 'Valid payment method is on file',
      checked: false
    },
    {
      id: 'waiver',
      label: 'Waiver Signed',
      description: 'Required waiver/consent forms are signed',
      checked: false
    },
    {
      id: 'child',
      label: 'Child Information',
      description: 'Child profile is complete and up to date',
      checked: false
    }
  ]);

  const handleToggle = (id: string) => {
    setPrereqs(prev => prev.map(p => 
      p.id === id ? { ...p, checked: !p.checked } : p
    ));
  };

  const allChecked = prereqs.every(p => p.checked);
  const checkedCount = prereqs.filter(p => p.checked).length;
  const progress = (checkedCount / prereqs.length) * 100;

  const handleContinue = () => {
    if (allChecked && onReadyToContinue) {
      onReadyToContinue();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Prerequisites Check</h2>
        <p className="text-muted-foreground">
          Please confirm the following prerequisites before continuing with registration.
        </p>
      </div>

      <Progress value={progress} className="h-2" />

      <Card className="p-6 space-y-4">
        {prereqs.map((prereq) => (
          <div key={prereq.id} className="flex items-start space-x-3 p-3 rounded-lg hover:bg-accent/50 transition-colors">
            <Checkbox
              id={prereq.id}
              checked={prereq.checked}
              onCheckedChange={() => handleToggle(prereq.id)}
              className="mt-1"
            />
            <div className="flex-1 space-y-1">
              <Label
                htmlFor={prereq.id}
                className="text-base font-medium cursor-pointer flex items-center gap-2"
              >
                {prereq.checked ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
                {prereq.label}
              </Label>
              <p className="text-sm text-muted-foreground">{prereq.description}</p>
            </div>
          </div>
        ))}
      </Card>

      {allChecked && (
        <Alert className="border-green-600 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-900 dark:text-green-100">
            All prerequisites confirmed! You can now continue with registration.
          </AlertDescription>
        </Alert>
      )}

      {!allChecked && checkedCount > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {prereqs.length - checkedCount} prerequisite{prereqs.length - checkedCount !== 1 ? 's' : ''} remaining
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleContinue}
          disabled={!allChecked}
          size="lg"
        >
          Continue to Registration
        </Button>
      </div>
    </div>
  );
}
