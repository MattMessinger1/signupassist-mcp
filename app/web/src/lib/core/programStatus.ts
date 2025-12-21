/**
 * Program Status Display Helpers
 * Ported from src/lib/utils/programStatusHelpers.ts for widget use
 */

// Inline enums to avoid external dependencies
export enum ProgramStatus {
  OPEN = 'Open',
  REGISTER = 'Register',
  WAITLIST = 'Waitlist',
  FULL = 'Full',
  SOLD_OUT = 'Sold Out',
  CLOSED = 'Closed',
  RESTRICTED = 'Restricted',
  TBD = 'TBD',
  UNKNOWN = '-',
}

export enum ProgramAccessLevel {
  PUBLIC = 'public',
  MEMBERS_ONLY = 'members_only',
  PASSWORD_PROTECTED = 'password_protected',
  RESTRICTED = 'restricted',
}

export interface ProgramRestriction {
  isRestricted: boolean;
  reason?: string;
  accessLevel?: ProgramAccessLevel;
}

export interface StatusDisplayConfig {
  variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'accent' | 'warning';
  label: string;
}

/**
 * Get display configuration for a program status
 */
export function getStatusDisplay(status?: string): StatusDisplayConfig {
  if (!status) {
    return { variant: 'secondary', label: '' };
  }

  const normalizedStatus = normalizeStatus(status);

  switch (normalizedStatus) {
    case ProgramStatus.OPEN:
    case ProgramStatus.REGISTER:
      return { variant: 'accent', label: 'Open' };
    
    case ProgramStatus.FULL:
    case ProgramStatus.SOLD_OUT:
    case ProgramStatus.CLOSED:
      return { variant: 'destructive', label: 'Full' };
    
    case ProgramStatus.WAITLIST:
      return { variant: 'warning', label: 'Waitlist' };
    
    case ProgramStatus.RESTRICTED:
      return { variant: 'destructive', label: 'Restricted' };
    
    case ProgramStatus.TBD:
      return { variant: 'outline', label: 'TBD' };
    
    default:
      return { variant: 'secondary', label: status };
  }
}

/**
 * Normalize status string to ProgramStatus enum
 */
export function normalizeStatus(status: string): ProgramStatus {
  const statusLower = status.toLowerCase().trim();
  
  if (/^(open|register)$/i.test(statusLower)) {
    return ProgramStatus.OPEN;
  }
  if (/^(full|sold out)$/i.test(statusLower)) {
    return ProgramStatus.FULL;
  }
  if (/^closed$/i.test(statusLower)) {
    return ProgramStatus.CLOSED;
  }
  if (/^waitlist$/i.test(statusLower)) {
    return ProgramStatus.WAITLIST;
  }
  if (/^restricted$/i.test(statusLower)) {
    return ProgramStatus.RESTRICTED;
  }
  if (/^tbd$/i.test(statusLower)) {
    return ProgramStatus.TBD;
  }
  
  return ProgramStatus.UNKNOWN;
}

/**
 * Detect if a program has restricted access based on content
 */
export function detectProgramRestrictions(
  body?: string,
  caption?: string,
  status?: string
): ProgramRestriction {
  const contentToCheck = `${body || ''} ${caption || ''}`.toLowerCase();
  
  const hasPasswordRestriction = /password|members-only|member only|membership required/i.test(contentToCheck);
  const hasAccessRestriction = /restricted|invite only|by invitation/i.test(contentToCheck);
  
  const statusRestricted = status && /^(restricted|closed|full|sold out)$/i.test(status);
  
  if (hasPasswordRestriction) {
    return {
      isRestricted: true,
      reason: 'Password or membership required',
      accessLevel: ProgramAccessLevel.PASSWORD_PROTECTED,
    };
  }
  
  if (hasAccessRestriction) {
    return {
      isRestricted: true,
      reason: 'Restricted access',
      accessLevel: ProgramAccessLevel.RESTRICTED,
    };
  }
  
  if (statusRestricted && (hasPasswordRestriction || hasAccessRestriction)) {
    return {
      isRestricted: true,
      reason: 'Limited availability',
      accessLevel: ProgramAccessLevel.MEMBERS_ONLY,
    };
  }
  
  return { isRestricted: false };
}

/**
 * Format caption parts for display
 */
export function formatCaptionParts(caption: string): string[] {
  return caption
    .split('•')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Get button variant based on label content
 */
export function getButtonVariantForLabel(
  label: string,
  explicitVariant?: string,
  isLink = false
): 'accent' | 'warning' | 'default' | 'outline' {
  if (explicitVariant === 'accent' || explicitVariant === 'warning') {
    return explicitVariant;
  }
  
  const lowerLabel = label.toLowerCase();
  
  // Green for selection actions
  if (lowerLabel.includes('select this') || lowerLabel.includes('select program')) {
    return 'accent';
  }
  
  // Yellow for scheduling actions
  if (lowerLabel.includes('schedule ahead') || lowerLabel.includes('can schedule')) {
    return 'warning';
  }
  
  // Default for links
  if (isLink) {
    return 'default';
  }
  
  return 'outline';
}

/**
 * Check if a program is available for registration
 */
export function isProgramAvailable(status?: string): boolean {
  if (!status) return true;
  const normalized = normalizeStatus(status);
  return normalized === ProgramStatus.OPEN || normalized === ProgramStatus.REGISTER;
}

/**
 * Check if a program allows waitlist signup
 */
export function canJoinWaitlist(status?: string): boolean {
  if (!status) return false;
  return normalizeStatus(status) === ProgramStatus.WAITLIST;
}
