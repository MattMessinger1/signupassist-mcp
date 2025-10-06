import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatusIconProps {
  status: 'pass' | 'fail' | 'unknown';
  className?: string;
}

export function StatusIcon({ status, className }: StatusIconProps) {
  const iconClasses = cn('h-5 w-5 flex-shrink-0', className);

  switch (status) {
    case 'pass':
      return <CheckCircle2 className={cn(iconClasses, 'text-green-600')} aria-hidden="true" />;
    case 'fail':
      return <XCircle className={cn(iconClasses, 'text-red-600')} aria-hidden="true" />;
    case 'unknown':
      return <Loader2 className={cn(iconClasses, 'text-muted-foreground animate-spin')} aria-hidden="true" />;
  }
}
