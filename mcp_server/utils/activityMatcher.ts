/**
 * Activity Matcher Utility
 * Maps user activity keywords to normalized types and finds matching providers
 */

import { getAllActiveOrganizations, OrgConfig } from '../config/organizations.js';

// Maps user keywords to normalized activity types
// Multi-word phrase patterns (checked first for compound activities)
const ACTIVITY_PHRASE_MAP: Record<string, string> = {
  'basket weaving': 'crafts',
  'ice skating': 'skating',
  'figure skating': 'skating',
  'martial arts': 'martial-arts',
  'rock climbing': 'climbing',
  'horseback riding': 'equestrian',
  'scuba diving': 'diving',
  'flag football': 'football',
  'cross country': 'running',
  'track and field': 'athletics',
  'arts and crafts': 'crafts',
  'creative writing': 'writing',
};

// Single-word keyword map
const ACTIVITY_KEYWORD_MAP: Record<string, string> = {
  // Swimming
  'swim': 'swimming',
  'swimming': 'swimming',
  'pool': 'swimming',
  'aquatics': 'swimming',
  
  // Coding/Programming
  'code': 'coding',
  'coding': 'coding',
  'programming': 'coding',
  'computer': 'coding',
  'software': 'coding',
  
  // Robotics
  'robot': 'robotics',
  'robots': 'robotics',
  'robotics': 'robotics',
  
  // STEM
  'stem': 'stem',
  'science': 'stem',
  'technology': 'stem',
  'engineering': 'stem',
  'math': 'stem',
  
  // Sports
  'soccer': 'soccer',
  'football': 'football',
  'ski': 'skiing',
  'skiing': 'skiing',
  'snowboard': 'snowboarding',
  'snowboarding': 'snowboarding',
  'basketball': 'basketball',
  'baseball': 'baseball',
  'tennis': 'tennis',
  'golf': 'golf',
  'hockey': 'hockey',
  'lacrosse': 'lacrosse',
  'volleyball': 'volleyball',
  'gymnastics': 'gymnastics',
  'cheer': 'cheerleading',
  'cheerleading': 'cheerleading',
  'martial': 'martial-arts',
  'karate': 'martial-arts',
  'taekwondo': 'martial-arts',
  'judo': 'martial-arts',
  'archery': 'archery',
  'fencing': 'fencing',
  'wrestling': 'wrestling',
  'boxing': 'boxing',
  'yoga': 'yoga',
  'pilates': 'pilates',
  'climbing': 'climbing',
  'skating': 'skating',
  'running': 'running',
  'track': 'athletics',
  'athletics': 'athletics',
  
  // Arts & Crafts
  'dance': 'dance',
  'dancing': 'dance',
  'ballet': 'dance',
  'art': 'art',
  'arts': 'art',
  'painting': 'art',
  'drawing': 'art',
  'pottery': 'crafts',
  'ceramics': 'crafts',
  'weaving': 'crafts',
  'crafts': 'crafts',
  'craft': 'crafts',
  'music': 'music',
  'piano': 'music',
  'guitar': 'music',
  'violin': 'music',
  'drum': 'music',
  'drums': 'music',
  'singing': 'music',
  'voice': 'music',
  'theater': 'theater',
  'theatre': 'theater',
  'acting': 'theater',
  'drama': 'theater',
  
  // Other activities
  'camp': 'camp',
  'cooking': 'cooking',
  'baking': 'cooking',
  'chess': 'chess',
  'tutoring': 'tutoring',
  'tutor': 'tutoring',
  'darts': 'darts',
  'photography': 'photography',
  'writing': 'writing',
  'gardening': 'gardening',
  'sewing': 'crafts',
  'knitting': 'crafts',
  'fishing': 'fishing',
  'hunting': 'hunting',
  'sailing': 'sailing',
  'rowing': 'rowing',
  'kayak': 'kayaking',
  'kayaking': 'kayaking',
  'canoeing': 'canoeing',
  'diving': 'diving',
  'equestrian': 'equestrian',
  'riding': 'equestrian',
};

/**
 * Normalize an activity keyword to a standard type
 */
export function normalizeActivity(activity: string): string | null {
  const lower = activity.toLowerCase().trim();
  return ACTIVITY_KEYWORD_MAP[lower] || null;
}

/**
 * Get all keywords that map to a normalized activity type
 * Used for filtering programs by activity
 */
export function getActivityKeywords(normalizedActivity: string): string[] {
  const keywords: string[] = [normalizedActivity];
  
  // Add all keywords that map to this activity
  for (const [keyword, activity] of Object.entries(ACTIVITY_KEYWORD_MAP)) {
    if (activity === normalizedActivity && !keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }
  
  return keywords;
}

/**
 * Extract activity type from a user message
 * Checks multi-word phrases first, then single keywords
 * Returns the first recognized activity
 */
export function extractActivityFromMessage(message: string): string | null {
  const lower = message.toLowerCase();
  
  // Check phrases first (multi-word activities)
  for (const [phrase, activity] of Object.entries(ACTIVITY_PHRASE_MAP)) {
    if (lower.includes(phrase)) {
      return activity;
    }
  }
  
  // Then check single-word keywords
  const words = lower.split(/\s+/);
  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, '');
    const normalized = normalizeActivity(cleaned);
    if (normalized) {
      return normalized;
    }
  }
  
  return null;
}

/**
 * Get human-readable activity name for display
 */
export function getActivityDisplayName(normalizedActivity: string): string {
  const displayNames: Record<string, string> = {
    'swimming': 'swimming',
    'coding': 'coding',
    'robotics': 'robotics',
    'stem': 'STEM',
    'soccer': 'soccer',
    'skiing': 'skiing',
    'snowboarding': 'snowboarding',
    'basketball': 'basketball',
    'baseball': 'baseball',
    'tennis': 'tennis',
    'golf': 'golf',
    'hockey': 'hockey',
    'lacrosse': 'lacrosse',
    'volleyball': 'volleyball',
    'gymnastics': 'gymnastics',
    'cheerleading': 'cheerleading',
    'martial-arts': 'martial arts',
    'dance': 'dance',
    'art': 'art',
    'music': 'music',
    'theater': 'theater',
    'camp': 'camp',
    'cooking': 'cooking',
    'chess': 'chess',
    'tutoring': 'tutoring',
  };
  
  return displayNames[normalizedActivity] || normalizedActivity;
}

/**
 * Find providers that offer a specific activity type
 */
export function findProvidersForActivity(activity: string): OrgConfig[] {
  const normalized = normalizeActivity(activity) || activity.toLowerCase();
  
  return getAllActiveOrganizations().filter(org => {
    // Check activityTypes array if defined
    if (org.activityTypes && org.activityTypes.length > 0) {
      return org.activityTypes.includes(normalized);
    }
    return false;
  });
}

/**
 * Check if any provider offers an activity
 */
export function hasProviderForActivity(activity: string): boolean {
  return findProvidersForActivity(activity).length > 0;
}
