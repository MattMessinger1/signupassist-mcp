import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
  className?: string;
}

export default function StepIndicator({
  currentStep,
  totalSteps,
  stepLabels = [],
  className,
}: StepIndicatorProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div className={cn('w-full max-w-2xl mx-auto mb-8', className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isComplete = step < currentStep;
          const isCurrent = step === currentStep;
          const label = stepLabels[index] || `Step ${step}`;

          return (
            <div key={step} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="flex flex-col items-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all',
                    isComplete && 'bg-green-600 text-white',
                    isCurrent && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                    !isComplete && !isCurrent && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isComplete ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    step
                  )}
                </motion.div>
                
                {/* Label */}
                <span
                  className={cn(
                    'mt-2 text-xs font-medium text-center whitespace-nowrap',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {label}
                </span>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="flex-1 px-2 mb-6">
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: '0%' }}
                      animate={{ width: isComplete ? '100%' : '0%' }}
                      transition={{ duration: 0.5, delay: index * 0.1 + 0.2 }}
                      className="h-full bg-green-600"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
