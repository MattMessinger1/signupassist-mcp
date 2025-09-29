/**
 * Program mapping configuration for SkiClubPro
 * Maps user-friendly program references to actual SkiClubPro program IDs
 */

export interface ProgramMapping {
  text_ref: string;
  actual_id: string;
  title: string;
  description?: string;
  org_ref: string;
}

/**
 * Program mappings for different ski clubs
 * This allows us to map user-friendly names to actual SkiClubPro numeric IDs
 */
export interface ProgramDetails extends ProgramMapping {
  schedule: string;
  age_range: string;
  skill_level: string;
  price: string;
}

export const PROGRAM_MAPPINGS: Record<string, ProgramDetails[]> = {
  'blackhawk-ski-club': [
    {
      text_ref: 'blackhawk_winter',
      actual_id: '309',
      title: 'Nordic Kids Wednesday',
      description: 'Wednesday Nordic Kids Program',
      org_ref: 'blackhawk-ski-club',
      schedule: 'Registration opens December 1st, 2025',
      age_range: '6-12 years',
      skill_level: 'All levels',
      price: '$175/session'
    },
    {
      text_ref: 'blackhawk_beginner_sat',
      actual_id: '310',
      title: 'Beginner Skiing - Saturday Morning',
      description: 'Perfect for first-time skiers ages 4-8',
      org_ref: 'blackhawk-ski-club',
      schedule: 'Registration opens November 15th, 2025',
      age_range: '4-8 years',
      skill_level: 'Beginner',
      price: '$165/session'
    },
    {
      text_ref: 'blackhawk_intermediate_sun',
      actual_id: '311',
      title: 'Intermediate Skiing - Sunday Afternoon',
      description: 'For kids who can ski basic slopes confidently',
      org_ref: 'blackhawk-ski-club',
      schedule: 'Registration opens December 15th, 2025',
      age_range: '8-14 years',
      skill_level: 'Intermediate',
      price: '$185/session'
    }
  ],
  
  'oak-park-ski-club': [
    {
      text_ref: 'oakpark_beginner',
      actual_id: '201',
      title: 'Beginner Program',
      description: 'Entry level skiing program',
      org_ref: 'oak-park-ski-club',
      schedule: 'Registration opens January 10th, 2026',
      age_range: '5-10 years',
      skill_level: 'Beginner',
      price: '$150/session'
    }
  ]
};

/**
 * Get the actual SkiClubPro program ID from a text reference
 */
export function getProgramId(textRef: string, orgRef: string = 'blackhawk-ski-club'): string {
  const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS['blackhawk-ski-club'];
  const mapping = mappings.find(m => m.text_ref === textRef);
  
  if (mapping) {
    return mapping.actual_id;
  }
  
  // If no mapping found, assume it might already be an ID or return as-is
  console.warn(`No program mapping found for ${textRef} in ${orgRef}, using as-is`);
  return textRef;
}

/**
 * Get program info by text reference
 */
export function getProgramInfo(textRef: string, orgRef: string = 'blackhawk-ski-club'): ProgramMapping | null {
  const mappings = PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS['blackhawk-ski-club'];
  return mappings.find(m => m.text_ref === textRef) || null;
}

/**
 * Get all available programs for an organization
 */
export function getAvailablePrograms(orgRef: string = 'blackhawk-ski-club'): ProgramMapping[] {
  return PROGRAM_MAPPINGS[orgRef] || PROGRAM_MAPPINGS['blackhawk-ski-club'] || [];
}