/**
 * Audience Parser Utility
 * 
 * Auto-detects whether a program is for "kids", "adults", or "all"
 * by parsing title, description, and age_range fields.
 * 
 * Can be overridden via manual `audience` field in cached_provider_feed.
 */

export type Audience = 'kids' | 'adults' | 'all' | 'unknown';

export interface AudienceResult {
  audience: Audience;
  ageMin?: number;
  ageMax?: number;
  source: 'manual' | 'parsed' | 'inferred';
}

/**
 * Parse age range from text like "Ages 7-11", "Age 9–13", "7-11 years", etc.
 */
function extractAgeRange(text: string): { min: number; max: number } | null {
  if (!text) return null;
  
  // Match patterns like "Ages 7-11", "Age 9–13", "ages 5 - 12"
  const agePatterns = [
    /ages?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/i,
    /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:years?|yrs?|yo)/i,
    /\((\d{1,2})\s*[-–]\s*(\d{1,2})\)/,
  ];
  
  for (const pattern of agePatterns) {
    const match = text.match(pattern);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      if (!isNaN(min) && !isNaN(max) && min < max) {
        return { min, max };
      }
    }
  }
  
  return null;
}

/**
 * Detect audience keywords in text
 */
function detectAudienceKeywords(text: string): 'kids' | 'adults' | null {
  if (!text) return null;
  
  const kidsPatterns = /\b(kids?|child|children|youth|teen|teens|junior|jr\.|elementary|toddler|preschool)\b/i;
  const adultPatterns = /\b(adults?|grown[-\s]?ups?|seniors?|18\+|21\+|over\s*18|parent|mature)\b/i;
  
  const hasKidsKeyword = kidsPatterns.test(text);
  const hasAdultKeyword = adultPatterns.test(text);
  
  // If both or neither, return null (ambiguous)
  if (hasKidsKeyword && !hasAdultKeyword) return 'kids';
  if (hasAdultKeyword && !hasKidsKeyword) return 'adults';
  
  return null;
}

/**
 * Classify audience based on age range
 */
function classifyByAge(ageMin: number, ageMax: number): Audience {
  // Clearly kids: max age under 18
  if (ageMax < 18) return 'kids';
  
  // Clearly adults: min age 18+
  if (ageMin >= 18) return 'adults';
  
  // Mixed: spans both kids and adults
  return 'all';
}

/**
 * Parse audience from program data
 * 
 * Priority:
 * 1. Manual override (audience field)
 * 2. Parsed from age_range field
 * 3. Inferred from title/description keywords
 * 4. Default to 'unknown'
 */
export function parseAudience(program: {
  audience?: string | null;
  age_range?: string | null;
  title?: string | null;
  description?: string | null;
}): AudienceResult {
  // 1. Manual override
  if (program.audience) {
    const manual = program.audience.toLowerCase().trim();
    if (['kids', 'adults', 'all'].includes(manual)) {
      return {
        audience: manual as Audience,
        source: 'manual',
      };
    }
  }
  
  // 2. Parse from explicit age_range field
  if (program.age_range) {
    const range = extractAgeRange(program.age_range);
    if (range) {
      return {
        audience: classifyByAge(range.min, range.max),
        ageMin: range.min,
        ageMax: range.max,
        source: 'parsed',
      };
    }
  }
  
  // 3. Try to extract from title
  const titleRange = extractAgeRange(program.title || '');
  if (titleRange) {
    return {
      audience: classifyByAge(titleRange.min, titleRange.max),
      ageMin: titleRange.min,
      ageMax: titleRange.max,
      source: 'parsed',
    };
  }
  
  // 4. Try to extract from description
  const descRange = extractAgeRange(program.description || '');
  if (descRange) {
    return {
      audience: classifyByAge(descRange.min, descRange.max),
      ageMin: descRange.min,
      ageMax: descRange.max,
      source: 'parsed',
    };
  }
  
  // 5. Infer from keywords
  const combinedText = [program.title, program.description].filter(Boolean).join(' ');
  const keywordAudience = detectAudienceKeywords(combinedText);
  if (keywordAudience) {
    return {
      audience: keywordAudience,
      source: 'inferred',
    };
  }
  
  // 6. Default
  return {
    audience: 'unknown',
    source: 'inferred',
  };
}

/**
 * Check if programs match the requested audience
 * Returns mismatch info if there's a clear mismatch
 */
export function checkAudienceMismatch(
  programs: Array<{ audience?: string | null; age_range?: string | null; title?: string | null; description?: string | null }>,
  requestedAudience: 'adults' | 'kids' | null
): { hasMismatch: boolean; foundAudience?: string; programCount: number } {
  if (!requestedAudience || programs.length === 0) {
    return { hasMismatch: false, programCount: programs.length };
  }
  
  const parsed = programs.map(p => parseAudience(p));
  
  if (requestedAudience === 'adults') {
    // User wants adults - check if we only have kids programs
    const kidsPrograms = parsed.filter(p => p.audience === 'kids');
    const adultOrAllPrograms = parsed.filter(p => p.audience === 'adults' || p.audience === 'all');
    
    if (kidsPrograms.length > 0 && adultOrAllPrograms.length === 0) {
      // All programs are for kids only
      const ageRanges = parsed
        .filter(p => p.ageMin !== undefined && p.ageMax !== undefined)
        .map(p => `ages ${p.ageMin}-${p.ageMax}`);
      
      const uniqueRanges = [...new Set(ageRanges)].slice(0, 3);
      const foundAudience = uniqueRanges.length > 0 
        ? uniqueRanges.join(', ')
        : 'kids programs';
      
      return {
        hasMismatch: true,
        foundAudience,
        programCount: programs.length,
      };
    }
  }
  
  if (requestedAudience === 'kids') {
    // User wants kids - check if we only have adult programs
    const adultPrograms = parsed.filter(p => p.audience === 'adults');
    const kidsOrAllPrograms = parsed.filter(p => p.audience === 'kids' || p.audience === 'all');
    
    if (adultPrograms.length > 0 && kidsOrAllPrograms.length === 0) {
      return {
        hasMismatch: true,
        foundAudience: 'adults-only programs',
        programCount: programs.length,
      };
    }
  }
  
  return { hasMismatch: false, programCount: programs.length };
}
