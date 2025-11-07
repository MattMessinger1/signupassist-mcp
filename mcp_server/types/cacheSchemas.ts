/**
 * Shared type definitions for cached program data
 * Used by cache population, AIOrchestrator, and discovery systems
 */

export interface PrerequisiteCheck {
  required: boolean;
  check: string;
  message: string;
}

export interface PrerequisiteSchema {
  [programRef: string]: {
    [checkName: string]: PrerequisiteCheck;
  };
}

export interface QuestionField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  helper_text?: string;
  isPriceBearing?: boolean;
}

export interface QuestionsSchema {
  [programRef: string]: {
    fields: QuestionField[];
  };
}

export interface DeepLinkSet {
  registration_start: string;
  account_creation: string;
  program_details: string;
}

export interface DeepLinksSchema {
  [programRef: string]: DeepLinkSet;
}

export interface CachedProgramData {
  program_ref: string;
  title: string;
  dates?: string;
  schedule_text?: string;
  age_range?: string;
  price?: string;
  status?: string;
  theme?: string;
  age_min?: number;
  age_max?: number;
}

export interface EnhancedCacheEntry {
  org_ref: string;
  category: string;
  programs_by_theme: { [theme: string]: CachedProgramData[] };
  prerequisites_schema: PrerequisiteSchema;
  questions_schema: QuestionsSchema;
  deep_links: DeepLinksSchema;
  metadata?: {
    cached_by?: string;
    programs_count?: number;
    cached_timestamp?: string;
  };
  cached_at: string;
  expires_at: string;
}

/**
 * Checklist card format for pre-login display
 */
export interface ChecklistCard {
  type: 'checklist';
  title: string;
  program_ref: string;
  org_ref?: string;
  theme?: string;
  prerequisites: {
    [checkName: string]: PrerequisiteCheck;
  };
  questions: QuestionField[];
  deep_link: string;
  cta: {
    label: string;
    action: 'show_finish_options';
    data: { program_ref: string };
  };
}

/**
 * Cache result with checklist cards
 */
export interface CacheResult {
  hit: boolean;
  programs: CachedProgramData[];
  checklistCards?: ChecklistCard[];
  timestamp?: string;
}
