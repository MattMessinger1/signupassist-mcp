/**
 * Shared Program Type Definitions
 * Single source of truth for program status and access levels
 */

export type Provider = 'skiclubpro' | 'bookeo' | 'campminder' | 'daysmart';

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

export interface CardAction {
  type: "link" | "postback";
  label: string;
  href?: string;
  payload?: {
    intent: string;
    program_id?: string;
    program_ref?: string;
    org_ref?: string;
    theme?: string;
    is_restricted?: boolean;
    restriction_reason?: string;
  };
}

export interface ProgramCard {
  title: string;
  subtitle: string;
  caption: string;
  body: string;
  actions: CardAction[];
  program_ref?: string;
  org_ref?: string;
  isHeader?: boolean;
  status?: ProgramStatus;
  restriction?: ProgramRestriction;
}

export interface CardGroup {
  title: string;
  cards: ProgramCard[];
}

export interface CTAChip {
  label: string;
  payload: {
    intent: string;
    theme?: string;
  };
}

export interface GroupedCardsPayload {
  type: "cards-grouped";
  groups: CardGroup[];
  cta?: {
    type: "chips";
    options: CTAChip[];
  };
}
