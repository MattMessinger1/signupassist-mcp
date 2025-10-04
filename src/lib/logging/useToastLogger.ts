import { useToast } from '@/hooks/use-toast';
import { useCallback } from 'react';

export type LogStatus = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  stage: string;
  message: string;
  status: LogStatus;
  metadata?: Record<string, any>;
}

/**
 * Hook for unified toast + console logging
 * 
 * Usage:
 * const toastLogger = useToastLogger();
 * toastLogger('field_discovery', 'Fields discovered successfully', 'success', { count: 5 });
 */
export function useToastLogger() {
  const { toast } = useToast();

  const log = useCallback((
    stage: string,
    message: string,
    status: LogStatus = 'info',
    metadata?: Record<string, any>
  ) => {
    // Console logging with collapsible group
    console.groupCollapsed(
      `[${status.toUpperCase()}] ${stage}: ${message}`
    );
    console.log('Stage:', stage);
    console.log('Message:', message);
    console.log('Status:', status);
    if (metadata) {
      console.log('Metadata:', metadata);
    }
    console.log('Timestamp:', new Date().toISOString());
    console.groupEnd();

    // Toast notification
    const toastVariant = 
      status === 'error' ? 'destructive' :
      status === 'warning' ? 'default' :
      'default';

    const toastTitle = 
      status === 'success' ? '✓ Success' :
      status === 'error' ? '✗ Error' :
      status === 'warning' ? '⚠ Warning' :
      'ℹ Info';

    toast({
      title: toastTitle,
      description: message,
      variant: toastVariant,
    });

    // Return the log entry for potential further use
    return {
      stage,
      message,
      status,
      metadata,
      timestamp: new Date().toISOString()
    };
  }, [toast]);

  return log;
}
