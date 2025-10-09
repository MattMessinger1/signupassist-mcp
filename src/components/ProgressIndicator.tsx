import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Lock } from "lucide-react";

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
  completedSteps?: number[];
  lockedSteps?: number[];
}

export function ProgressIndicator({ 
  currentStep, 
  totalSteps, 
  stepLabels,
  completedSteps = [],
  lockedSteps = []
}: ProgressIndicatorProps) {
  const progress = (currentStep / totalSteps) * 100;
  const completedCount = completedSteps.length > 0 ? completedSteps.length : currentStep;

  return (
    <Card className="mb-6 bg-muted/30">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="font-medium">
                {completedCount} of {totalSteps} Steps Complete
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          
          <Progress value={progress} className="h-2" />
          
          {/* Step indicator dots */}
          <div className="flex items-center justify-between gap-1 pt-2">
            {Array.from({ length: totalSteps }).map((_, index) => {
              const stepNum = index + 1;
              const isCompleted = completedSteps.includes(stepNum);
              const isLocked = lockedSteps.includes(stepNum);
              const isCurrent = stepNum === currentStep;
              
              return (
                <div key={stepNum} className="flex flex-col items-center gap-1 flex-1">
                  <div 
                    className={`h-2 w-full rounded-full transition-all ${
                      isCompleted ? 'bg-green-600' :
                      isCurrent ? 'bg-primary' :
                      isLocked ? 'bg-muted' :
                      'bg-muted-foreground/30'
                    }`}
                  />
                  {stepLabels && stepLabels[index] && (
                    <span className={`text-xs text-center ${
                      isCompleted ? 'text-green-600 font-medium' :
                      isCurrent ? 'text-primary font-medium' :
                      isLocked ? 'text-muted-foreground' :
                      'text-muted-foreground'
                    }`}>
                      {isLocked && <Lock className="h-3 w-3 inline mr-1" />}
                      {stepLabels[index]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
