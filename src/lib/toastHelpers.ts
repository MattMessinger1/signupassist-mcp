/**
 * toastHelpers.ts
 * Centralized toast utilities that use prompts.ts for consistent messaging
 */

import { toast } from '@/hooks/use-toast';
import { prompts } from './prompts';

type ToastVariant = 'default' | 'destructive';

interface ToastOptions {
  title?: string;
  description: string;
  variant?: ToastVariant;
}

/**
 * Maps backend error codes to user-friendly messages from prompts.ts
 */
const mapBackendError = (errorCode: string, context?: Record<string, any>): string => {
  switch (errorCode) {
    case 'LOGIN_FAILED':
      return prompts.backend.errors.LOGIN_FAILED;
    case 'PROGRAM_NOT_OPEN':
      return prompts.backend.errors.PROGRAM_NOT_OPEN;
    case 'BLOCKER':
      return prompts.backend.errors.BLOCKER;
    case 'PRICE_EXCEEDS_LIMIT':
      return prompts.backend.errors.PRICE_EXCEEDS_LIMIT;
    case 'UNKNOWN_ERROR':
    default:
      return prompts.backend.errors.UNKNOWN_ERROR;
  }
};

/**
 * Shows a toast using a prompt key or custom message
 */
export const showPromptToast = (
  key: string,
  options?: {
    variant?: ToastVariant;
    args?: any[];
    customTitle?: string;
  }
) => {
  const variant = options?.variant || 'default';
  const args = options?.args || [];

  // Handle backend error codes
  if (key.includes('ERROR') || key.includes('FAILED')) {
    const message = mapBackendError(key);
    toast({
      title: options?.customTitle || 'Error',
      description: message,
      variant: 'destructive',
    });
    return;
  }

  // Handle UI toast messages
  const toastMessages: Record<string, string | ((...args: any[]) => string)> = {
    'programs.updated': prompts.ui.toasts.programsUpdated,
    'prereqs.ok': prompts.ui.toasts.prereqsOk,
    'prereqs.missing': prompts.ui.toasts.prereqsMissing,
    'saved': prompts.ui.toasts.saved,
    'scheduled': prompts.ui.toasts.scheduled,
    'price.limit': prompts.ui.toasts.priceLimit,
    'program.selected': prompts.ui.programs.toastSelected,
    'child.selected': prompts.ui.child.toastSelected,
    'program.loadError': prompts.ui.programs.loadError,
    'child.notFound': prompts.ui.child.notFound,
    'signin.badLogin': prompts.ui.signin.errors.badLogin,
    'signin.missingPrereq': prompts.ui.signin.errors.prereqMissing,
  };

  const messageTemplate = toastMessages[key];
  
  if (!messageTemplate) {
    console.warn(`Unknown toast key: ${key}`);
    toast({
      title: options?.customTitle || 'Notification',
      description: key,
      variant,
    });
    return;
  }

  const message = typeof messageTemplate === 'function' 
    ? messageTemplate(...args) 
    : messageTemplate;

  toast({
    title: options?.customTitle || 'Success',
    description: message,
    variant,
  });
};

/**
 * Shows a success toast
 */
export const showSuccessToast = (title: string, description: string) => {
  toast({ title, description, variant: 'default' });
};

/**
 * Shows an error toast
 */
export const showErrorToast = (title: string, description: string) => {
  toast({ title, description, variant: 'destructive' });
};

/**
 * Shows a generic info toast
 */
export const showInfoToast = (description: string) => {
  toast({ description, variant: 'default' });
};
