/**
 * UI Payload Builder for Grouped Program Cards
 * 
 * UI_PAYLOAD__GROUPED_CARDS (Block 8)
 * 
 * Creates structured card payloads following Design DNA:
 * - Message → Grouped Cards → CTA chips
 * - Max 4 cards per group on first render
 * - Hide groups with zero items
 * - Filter by child age when provided (Quick Win #3)
 */

import type { GroupedProgram, ProgramGroup } from '../lib/programGrouping.js';

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
 * Filter programs by age range (Quick Win #3)
 */
function filterByAge<T extends { age_range?: string }>(
  programs: T[],
  childAge?: number
): T[] {
  if (!childAge) {
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
      return childAge >= minAge && childAge <= maxAge;
    }
    
    // Parse single age like "Age 8" or "8 years"
    const singleMatch = program.age_range.match(/(\d+)/);
    if (singleMatch) {
      const targetAge = parseInt(singleMatch[1], 10);
      return childAge === targetAge;
    }
    
    // Include if can't parse (avoid false negatives)
    return true;
  });
}

/**
 * Phase 1 Optimization: Soft ranking logic for intent-based sorting
 * Programs matching category or age get higher rank scores
 */
function rankPrograms<T extends { age_range?: string; title?: string; description?: string }>(
  programs: T[],
  intent: { category?: string; childAge?: number }
): Array<T & { _rank: number }> {
  return programs.map(p => {
    let rank = 0;
    
    // +2 points if category matches (check title/description for category keywords)
    if (intent.category && intent.category !== 'all') {
      const searchText = `${p.title || ''} ${p.description || ''}`.toLowerCase();
      const categoryLower = intent.category.toLowerCase();
      if (searchText.includes(categoryLower)) {
        rank += 2;
      }
    }
    
    // +1 point if age matches
    if (intent.childAge && p.age_range) {
      const ageMatch = p.age_range.match(/(\d+)[\s-]+(\d+)/);
      if (ageMatch) {
        const minAge = parseInt(ageMatch[1], 10);
        const maxAge = parseInt(ageMatch[2], 10);
        if (intent.childAge >= minAge && intent.childAge <= maxAge) {
          rank += 1;
        }
      }
    }
    
    return { ...p, _rank: rank };
  }).sort((a, b) => b._rank - a._rank);
}

/**
 * Build grouped cards payload from classified programs
 * 
 * Guidelines for rendering:
 * - Show at most 4 cards per group on first render
 * - If a group has zero items, hide that group
 * - For long lists, let users tap "Show more …" to request the next page for that theme
 * - Keep the visual rhythm: assistant message → grouped cards → CTA chips
 * - Filter by child age when provided (Quick Win #3)
 */
export function buildGroupedCardsPayload(
  groups: ProgramGroup[],
  maxCardsPerGroup: number = 4,
  childAge?: number,
  category?: string
): GroupedCardsPayload {
  
  // Phase 1 Optimization: Apply soft ranking before filtering
  const rankedGroups = groups.map(group => ({
    ...group,
    programs: rankPrograms(group.programs, { category, childAge })
  }));
  
  // Quick Win #3: Apply age filtering before building cards
  const filteredGroups = rankedGroups.map(group => ({
    ...group,
    programs: filterByAge(group.programs, childAge)
  }));
  
  // Filter out empty groups and limit cards per group
  const nonEmptyGroups = filteredGroups
    .filter(group => group.programs.length > 0)
    .map(group => ({
      title: group.theme,
      cards: group.programs.slice(0, maxCardsPerGroup).map(program => 
        buildProgramCard(program)
      )
    }));

  // Build CTA chips for groups with more than maxCardsPerGroup items
  const ctaChips: CTAChip[] = filteredGroups
    .filter(group => group.programs.length > maxCardsPerGroup)
    .map(group => ({
      label: `Show more ${group.theme}`,
      payload: {
        intent: "more_in_theme",
        theme: group.theme
      }
    }));

  // Add navigation chips for all non-empty themes
  const themeChips: CTAChip[] = filteredGroups
    .filter(group => group.programs.length > 0)
    .map(group => ({
      label: `Show ${group.theme}`,
      payload: {
        intent: "more_in_theme",
        theme: group.theme
      }
    }));

  return {
    type: "cards-grouped",
    groups: nonEmptyGroups,
    cta: ctaChips.length > 0 || themeChips.length > 0 ? {
      type: "chips",
      options: [...ctaChips, ...themeChips]
    } : undefined
  };
}

/**
 * Build a single program card from structured data
 * Quick Win #5: Add program_ref and org_ref to card metadata
 */
function buildProgramCard(program: GroupedProgram): ProgramCard {
  // Build subtitle: schedule • age_range (if present)
  const subtitleParts = [program.schedule];
  if (program.age_range && program.age_range !== 'All ages') {
    subtitleParts.push(program.age_range);
  }
  const subtitle = subtitleParts.join(' • ');

  // Build caption: price • status (if present)
  const captionParts = [];
  if (program.price && program.price !== 'See website') {
    captionParts.push(program.price);
  }
  if (program.status && program.status !== 'open') {
    captionParts.push(program.status);
  }
  const caption = captionParts.join(' • ');

  // Build actions: primary CTA + details button
  const actions: CardAction[] = [];
  
  // Quick Win #5: Make Register a direct link to cta_href
  if (program.cta_href) {
    actions.push({
      type: "link",
      label: program.cta_label || "Register",
      href: program.cta_href
    });
  }
  
  // Quick Win #5: Wire Details button with program_ref and org_ref
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

  return {
    title: program.title,
    subtitle,
    caption,
    body: program.brief || '',
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
