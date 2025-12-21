/**
 * StepIndicator - Progress indicator for multi-step forms
 * Adapted from src/components/StepIndicator.tsx for widget use
 */

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
  className?: string;
}

export function StepIndicator({
  currentStep,
  totalSteps,
  stepLabels = [],
  className,
}: StepIndicatorProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div className={cn('w-full max-w-2xl mx-auto mb-6', className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isComplete = step < currentStep;
          const isCurrent = step === currentStep;
          const label = stepLabels[index] || `Step ${step}`;

          return (
            <div key={step} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all',
                    isComplete && 'bg-green-600 text-white',
                    isCurrent && 'bg-blue-600 text-white ring-4 ring-blue-200',
                    !isComplete && !isCurrent && 'bg-gray-200 text-gray-500'
                  )}
                >
                  {isComplete ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step
                  )}
                </div>
                
                {/* Label */}
                <span
                  className={cn(
                    'mt-2 text-xs font-medium text-center whitespace-nowrap',
                    isCurrent ? 'text-gray-900' : 'text-gray-500'
                  )}
                >
                  {label}
                </span>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="flex-1 px-2 mb-6">
                  <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full bg-green-600 transition-all duration-500',
                        isComplete ? 'w-full' : 'w-0'
                      )}
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
