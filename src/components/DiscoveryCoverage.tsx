import { useState } from 'react';
import { ChevronDown, ChevronRight, Info, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface DiscoveryCoverageProps {
  metadata?: {
    programLoops?: number;
    prerequisitesLoops?: number;
    urlsVisited?: string[];
    stops?: {
      reason: 'payment_detected' | 'success' | 'max_iterations' | 'no_new_errors';
      evidence?: any;
    };
    fieldsFound?: number;
  };
}

export function DiscoveryCoverage({ metadata }: DiscoveryCoverageProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!metadata) return null;

  const stopReasonLabels = {
    payment_detected: { label: 'Payment Detected', icon: AlertCircle, className: 'text-yellow-700 dark:text-yellow-300' },
    success: { label: 'Success Detected', icon: CheckCircle, className: 'text-green-700 dark:text-green-300' },
    max_iterations: { label: 'Max Steps Reached', icon: Info, className: 'text-blue-700 dark:text-blue-300' },
    no_new_errors: { label: 'Complete', icon: CheckCircle, className: 'text-green-700 dark:text-green-300' }
  };

  const stopConfig = metadata.stops?.reason 
    ? stopReasonLabels[metadata.stops.reason]
    : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-muted">
        <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>Discovery Details</span>
            <Badge variant="outline" className="ml-2">
              {metadata.fieldsFound || 0} fields
            </Badge>
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              {metadata.programLoops !== undefined && (
                <div>
                  <p className="text-muted-foreground mb-1">Program Steps</p>
                  <p className="font-medium">{metadata.programLoops}</p>
                </div>
              )}
              {metadata.prerequisitesLoops !== undefined && (
                <div>
                  <p className="text-muted-foreground mb-1">Prerequisite Checks</p>
                  <p className="font-medium">{metadata.prerequisitesLoops}</p>
                </div>
              )}
            </div>

            {stopConfig && (
              <div className="pt-2 border-t">
                <p className="text-muted-foreground mb-2">Stop Reason</p>
                <div className="flex items-center gap-2">
                  <stopConfig.icon className={`h-4 w-4 ${stopConfig.className}`} />
                  <span className={stopConfig.className}>{stopConfig.label}</span>
                </div>
              </div>
            )}

            {metadata.urlsVisited && metadata.urlsVisited.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-muted-foreground mb-2">Pages Visited ({metadata.urlsVisited.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {metadata.urlsVisited.map((url, idx) => (
                    <div key={idx} className="text-xs font-mono bg-muted/50 p-1.5 rounded truncate">
                      {new URL(url).pathname}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
