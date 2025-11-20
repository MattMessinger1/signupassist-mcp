/**
 * Shared Program Type Definitions (Backend)
 * Single source of truth for program status and access levels
 */

export enum ProgramStatus {
  OPEN = 'Open',
  REGISTER = 'Register',
  WAITLIST = 'Waitlist',
  FULL = 'Full',
  SOLD_OUT = 'Sold Out',
  CLOSED = 'Closed',
  RESTRICTED = 'Restricted',
  TBD = 'TBD',
  UNKNOWN = '-'
}

export enum ProgramAccessLevel {
  PUBLIC = 'public',
  MEMBERS_ONLY = 'members_only',
  PASSWORD_PROTECTED = 'password_protected',
  RESTRICTED = 'restricted'
}

export interface ProgramRestriction {
  isRestricted: boolean;
  reason?: string;
  accessLevel?: ProgramAccessLevel;
}
