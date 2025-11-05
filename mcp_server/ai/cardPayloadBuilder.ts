/**
 * UI Payload Builder for Grouped Program Cards (Prompt D Implementation)
 * 
 * Transforms extracted programs into grouped, concise cards with:
 * - Age-based filtering
 * - Theme grouping: "Lessons & Classes", "Race Team & Events", "Other"
 * - Status-priority sorting within groups
 * - Header cards + program cards with specific CTAs
 * - Limit to top 4 per group with "Show more" CTA if needed
 */

import type { GroupedProgram, ProgramGroup } from '../lib/programGrouping.js';

/**
 * Status priority mapping for sorting (lower = higher priority)
 */
const STATUS_PRIORITY: Record<string, number> = {
  'Open': 1,
  'Register': 1,
  'Waitlist': 2,
  'Sold Out': 3,
  'Full': 3,
  'Closed': 3,
  'TBD': 4,
  '-': 5,
  '': 6,
};

/**
 * Get status priority (default to 6 if not in map)
 */
function getStatusPriority(status?: string): number {
  if (!status) return 6;
  return STATUS_PRIORITY[status] || 6;
}

/**
 * Extract numeric price for sorting (returns Infinity if not parseable)
 */
function extractNumericPrice(price?: string): number {
  if (!price) return Infinity;
  const match = price.match(/\$?\s*(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : Infinity;
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

/**
 * Prompt D Step 1: Filter programs by target_age
 * Drop items where age_range clearly EXCLUDES the target age
 */
function filterByAge<T extends { age_range?: string }>(
  programs: T[],
  targetAge?: number
): T[] {
  if (!targetAge) {
    return programs; // No filtering if age not provided
  }
  
  return programs.filter(program => {
    if (!program.age_range) {
      return true; // Include programs without age restriction
    }
    
    // Parse age range like "Ages 7-10" or "7-10 years"
    const ageMatch = program.age_range.match(/(\d+)[\s-]+(\d+)/);
    if (ageMatch) {
      const minAge = parseInt(ageMatch[1], 10);
      const maxAge = parseInt(ageMatch[2], 10);
      // EXCLUDE if target age is outside the range
      return targetAge >= minAge && targetAge <= maxAge;
    }
    
    // Parse single age like "Age 8" or "8 years"
    const singleMatch = program.age_range.match(/(\d+)/);
    if (singleMatch) {
      const targetAgeExact = parseInt(singleMatch[1], 10);
      return targetAge === targetAgeExact;
    }
    
    // Include if can't parse (avoid false negatives)
    return true;
  });
}

/**
 * Prompt D Step 3: Sort programs within each group
 * Priority: Status > Price (low to high) > Title (A→Z)
 */
function sortProgramsByPriority<T extends { status?: string; price?: string; title?: string }>(
  programs: T[]
): T[] {
  return [...programs].sort((a, b) => {
    // 1. Status priority (lower number = higher priority)
    const statusA = getStatusPriority(a.status);
    const statusB = getStatusPriority(b.status);
    if (statusA !== statusB) return statusA - statusB;
    
    // 2. Price (lower price first)
    const priceA = extractNumericPrice(a.price);
    const priceB = extractNumericPrice(b.price);
    if (priceA !== priceB) return priceA - priceB;
    
    // 3. Title (A→Z)
    return (a.title || '').localeCompare(b.title || '');
  });
}

/**
 * Prompt D: Transform extracted programs into grouped, concise cards
 * 
 * Inputs:
 * - items[] as extracted
 * - optional target_age (integer)
 * - optional category_intent ("lessons"|"teams"|"other"|undefined)
 * 
 * Steps:
 * 1) Filter by target_age (drop items where age_range excludes that age)
 * 2) Group into themes: "Lessons & Classes", "Race Team & Events", "Other"
 * 3) Sort within groups: Status priority > Price (low→high) > Title (A→Z)
 * 4) Limit to top 4 items per group
 * 5) Build cards with header card + program cards with specific CTAs
 */
export function buildGroupedCardsPayload(
  groups: ProgramGroup[],
  maxCardsPerGroup: number = 4,
  targetAge?: number,
  categoryIntent?: string
): GroupedCardsPayload {
  
  // Step 1: Apply age filtering
  const filteredGroups = groups.map(group => ({
    ...group,
    programs: filterByAge(group.programs, targetAge)
  }));
  
  // Step 2: Normalize theme labels to final labels
  const normalizedGroups = filteredGroups.map(group => {
    let finalTheme = "Other";
    const themeLower = group.theme.toLowerCase();
    
    if (themeLower.includes('lesson') || themeLower.includes('class')) {
      finalTheme = "Lessons & Classes";
    } else if (themeLower.includes('race') || themeLower.includes('team') || themeLower.includes('event')) {
      finalTheme = "Race Team & Events";
    }
    
    return {
      ...group,
      theme: finalTheme
    };
  });
  
  // Step 3: Sort programs within each group by priority
  const sortedGroups = normalizedGroups.map(group => ({
    ...group,
    programs: sortProgramsByPriority(group.programs)
  }));
  
  // Filter out empty groups
  const nonEmptyGroups = sortedGroups.filter(group => group.programs.length > 0);
  
  // Step 4: Build cards with header + program cards
  const cardGroups: CardGroup[] = nonEmptyGroups.map(group => {
    const cards: ProgramCard[] = [];
    
    // Header card (no buttons)
    cards.push({
      title: group.theme,
      subtitle: `${group.programs.length} programs available`,
      caption: '',
      body: '',
      actions: [],
      isHeader: true
    });
    
    // Program cards (limit to top 4)
    const displayedPrograms = group.programs.slice(0, maxCardsPerGroup);
    displayedPrograms.forEach(program => {
      cards.push(buildProgramCard(program));
    });
    
    return {
      title: group.theme,
      cards
    };
  });
  
  // Build "Show more" CTA chips for groups with > 4 items
  const ctaChips: CTAChip[] = nonEmptyGroups
    .filter(group => group.programs.length > maxCardsPerGroup)
    .map(group => ({
      label: `Show more ${group.theme}`,
      payload: {
        intent: "more_in_theme",
        theme: group.theme
      }
    }));

  return {
    type: "cards-grouped",
    groups: cardGroups,
    cta: ctaChips.length > 0 ? {
      type: "chips",
      options: ctaChips
    } : undefined
  };
}

/**
 * Prompt D Step 4: Build a single program card
 * 
 * Card structure:
 * - title: program title
 * - subtitle: schedule • age_range
 * - caption: price (if any) • status badge
 * - body: description
 * - actions: "Details" (view_program) + "Register" (link to cta_href)
 */
function buildProgramCard(program: GroupedProgram): ProgramCard {
  // Build subtitle: schedule • age_range (if present)
  const subtitleParts = [];
  if (program.schedule) subtitleParts.push(program.schedule);
  if (program.age_range && program.age_range !== 'All ages') {
    subtitleParts.push(program.age_range);
  }
  const subtitle = subtitleParts.join(' • ');

  // Build caption: price (if any) • status badge
  const captionParts = [];
  if (program.price && program.price !== 'See website' && program.price !== '') {
    captionParts.push(program.price);
  }
  if (program.status && program.status !== '' && program.status !== '-') {
    captionParts.push(`Status: ${program.status}`);
  }
  const caption = captionParts.join(' • ');

  // Prompt D Step 4: Build two CTAs
  const actions: CardAction[] = [];
  
  // 1. "Details" → action: "view_program", payload: {org_ref, program_ref}
  actions.push({
    type: "postback",
    label: "Details",
    payload: {
      intent: "view_program",
      program_id: program.program_id,
      program_ref: program.program_ref || program.program_id,
      org_ref: program.org_ref
    }
  });
  
  // 2. "Register" → action: "link", url: cta_href (if present)
  if (program.cta_href) {
    actions.push({
      type: "link",
      label: "Register",
      href: program.cta_href
    });
  }

  return {
    title: program.title,
    subtitle,
    caption,
    body: program.brief || program.description || '',
    actions,
    program_ref: program.program_ref || program.program_id,
    org_ref: program.org_ref,
    isHeader: false
  };
}

/**
 * Legacy card builder for backward compatibility
 * Converts grouped payload to simple card array
 */
export function buildSimpleCardsFromGrouped(
  groupedPayload: GroupedCardsPayload
): Array<{
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, any>;
  buttons?: Array<{ label: string; action: string; variant?: string }>;
}> {
  const cards: Array<any> = [];
  
  for (const group of groupedPayload.groups) {
    for (const card of group.cards) {
      cards.push({
        title: card.title,
        subtitle: card.subtitle,
        description: `${card.caption}\n${card.body}`,
        metadata: {
          program_id: card.actions.find(a => a.type === 'postback')?.payload?.program_id
        },
        buttons: card.actions.map(action => {
          if (action.type === 'link') {
            return {
              label: action.label,
              action: 'open_link',
              variant: 'accent' as const
            };
          } else {
            return {
              label: action.label,
              action: 'program_details',
              variant: 'outline' as const
            };
          }
        })
      });
    }
  }
  
  return cards;
}
