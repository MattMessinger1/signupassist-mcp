/**
 * Program mapping configuration
 * Maps user-friendly program references to provider-specific program IDs
 */

export interface ProgramMapping {
  text_ref: string;
  actual_id: string;
  title: string;
  description?: string;
  org_ref: string;
}

export interface ProgramDetails extends ProgramMapping {
  schedule: string;
  age_range: string;
  skill_level: string;
  price: string;
}

/** Bookeo-oriented example mappings (product/slot identifiers are illustrative). */
export const PROGRAM_MAPPINGS: Record<string, ProgramDetails[]> = {
  'aim-design': [
    {
      text_ref: 'aim_robotics_intro',
      actual_id: 'PRODUCT_ROBOTICS_INTRO',
      title: 'Intro to Robotics',
      description: 'STEM robotics for beginners',
      org_ref: 'aim-design',
      schedule: 'See Bookeo calendar',
      age_range: '8–14 years',
      skill_level: 'Beginner',
      price: 'Varies'
    }
  ]
};

const DEFAULT_ORG = 'aim-design';

/**
 * Resolve a text reference to a provider program ID
 */
export function getProgramId(textRef: string, orgRef: string = DEFAULT_ORG): string {
  const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS[DEFAULT_ORG];
  const mapping = mappings?.find(m => m.text_ref === textRef);

  if (mapping) {
    return mapping.actual_id;
  }

  console.warn(`No program mapping found for ${textRef} in ${orgRef}, using as-is`);
  return textRef;
}

/**
 * Get program info by text reference
 */
export function getProgramInfo(textRef: string, orgRef: string = DEFAULT_ORG): ProgramDetails | null {
  const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS[DEFAULT_ORG];
  return mappings?.find(m => m.text_ref === textRef) || null;
}

/**
 * Get all available programs for an organization
 */
export function getAvailablePrograms(orgRef: string = DEFAULT_ORG): ProgramDetails[] {
  return PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS[DEFAULT_ORG] || [];
}
