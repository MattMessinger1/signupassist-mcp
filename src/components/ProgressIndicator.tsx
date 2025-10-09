import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle } from "lucide-react";

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
}

export function ProgressIndicator({ currentStep, totalSteps, stepLabels }: ProgressIndicatorProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <Card className="mb-6 bg-muted/30">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="font-medium">
                Step {currentStep} of {totalSteps} Complete
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          
          <Progress value={progress} className="h-2" />
          
          {stepLabels && currentStep < totalSteps && (
            <p className="text-sm text-muted-foreground">
              Next: {stepLabels[currentStep]}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
