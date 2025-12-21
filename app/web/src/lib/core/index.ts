/**
 * Core Library Exports
 * Re-export all core utilities for convenient importing
 */

// Fees
export {
  FEE_CONFIG,
  calculateServiceFee,
  calculateTotal,
  hasProgramFee,
} from './fees';

// Payment
export {
  PAYMENT_CONFIG,
  type PaymentStatus,
  type PaymentState,
  createInitialPaymentState,
  shouldContinuePolling,
  isPaymentTerminal,
  getPaymentStatusMessage,
} from './payment';

// Consent
export {
  type ConsentRequirement,
  type ConsentSection,
  type MandateScope,
  STANDARD_CONSENTS,
  buildMandateConsentSections,
  areAllConsentsGiven,
  countMissingConsents,
  buildConsentSummary,
} from './consent';

// Copy
export {
  COPY,
  mapToolNameToUserTitle,
  mapScopeToFriendly,
  formatScopesForDisplay,
} from './copy';

// Formatting
export {
  formatMoney,
  formatMoneyWithLocale,
  formatDate,
  formatDateTime,
  formatDateTimeFull,
  formatRelativeTime,
  formatPhone,
  formatName,
  truncate,
} from './formatting';

// Validation
export {
  VALIDATION_PATTERNS,
  VALIDATION_LIMITS,
  type ValidationResult,
  type GuardianData,
  type ParticipantData,
  validateEmail,
  validatePhone,
  validateName,
  validateDob,
  validateGuardianInfo,
  validateParticipantInfo,
  validateAllParticipants,
} from './validation';

// Program Status
export {
  ProgramStatus,
  ProgramAccessLevel,
  type ProgramRestriction,
  type StatusDisplayConfig,
  getStatusDisplay,
  normalizeStatus,
  detectProgramRestrictions,
  formatCaptionParts,
  getButtonVariantForLabel,
  isProgramAvailable,
  canJoinWaitlist,
} from './programStatus';
