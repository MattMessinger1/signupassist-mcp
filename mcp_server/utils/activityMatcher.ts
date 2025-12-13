/**
 * Activity Matcher Utility
 * Maps user activity keywords to normalized types and finds matching providers
 */

import { getAllActiveOrganizations, OrgConfig } from '../config/organizations.js';

// Maps user keywords to normalized activity types
const ACTIVITY_KEYWORD_MAP: Record<string, string> = {
  // Swimming
  'swim': 'swimming',
  'swimming': 'swimming',
  'pool': 'swimming',
  'aquatics': 'swimming',
  'water': 'swimming',
  
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
  'football': 'soccer',
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
  
  // Arts
  'dance': 'dance',
  'dancing': 'dance',
  'ballet': 'dance',
  'art': 'art',
  'arts': 'art',
  'painting': 'art',
  'drawing': 'art',
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
  
  // Other
  'camp': 'camp',
  'cooking': 'cooking',
  'chess': 'chess',
  'tutoring': 'tutoring',
  'tutor': 'tutoring',
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
 * Returns the first recognized activity keyword
 */
export function extractActivityFromMessage(message: string): string | null {
  const words = message.toLowerCase().split(/\s+/);
  
  for (const word of words) {
    // Clean punctuation
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
