import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FeeBreakdownCardProps {
  maxProviderChargeCents: number;
}

export function FeeBreakdownCard({ maxProviderChargeCents }: FeeBreakdownCardProps) {
  const contingencyBufferCents = Math.min(Math.round(maxProviderChargeCents * 0.10), 5000);
  const maxAuthorizationCents = maxProviderChargeCents + contingencyBufferCents;
  const signupAssistFeeCents = 2000;

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">Program Cost (Est.)</span>
            <span className="font-medium">{formatCurrency(maxProviderChargeCents)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm">Safety Buffer (10%/max $50)</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Buffer for hidden fees like taxes or credit card processing fees to prevent signup failures</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="font-medium">{formatCurrency(contingencyBufferCents)}</span>
          </div>
          
          <Separator />
          
          <div className="flex justify-between items-center">
            <span className="font-semibold">Max Authorization</span>
            <span className="font-semibold text-lg">{formatCurrency(maxAuthorizationCents)}</span>
          </div>
        </div>
        
        <Separator />
        
        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">SignupAssist Service Fee</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Only charged after successful registration completion</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <span className="font-medium">{formatCurrency(signupAssistFeeCents)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            (Only charged on success)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
