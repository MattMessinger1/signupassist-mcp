/**
 * Form Validation Rules and Functions
 * Pure validation logic for form inputs
 */

export const VALIDATION_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-()]{10,}$/,
  zipCode: /^\d{5}(-\d{4})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
} as const;

export const VALIDATION_LIMITS = {
  nameMinLength: 1,
  nameMaxLength: 100,
  emailMaxLength: 255,
  phoneMaxLength: 20,
  messageMaxLength: 1000,
} as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate email address
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];
  
  if (!email || email.trim().length === 0) {
    errors.push('Email is required');
  } else if (email.length > VALIDATION_LIMITS.emailMaxLength) {
    errors.push(`Email must be less than ${VALIDATION_LIMITS.emailMaxLength} characters`);
  } else if (!VALIDATION_PATTERNS.email.test(email)) {
    errors.push('Please enter a valid email address');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate phone number
 */
export function validatePhone(phone: string): ValidationResult {
  const errors: string[] = [];
  
  if (!phone || phone.trim().length === 0) {
    return { valid: true, errors: [] }; // Phone is often optional
  }
  
  if (!VALIDATION_PATTERNS.phone.test(phone)) {
    errors.push('Please enter a valid phone number');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate required name field
 */
export function validateName(name: string, fieldLabel = 'Name'): ValidationResult {
  const errors: string[] = [];
  
  if (!name || name.trim().length === 0) {
    errors.push(`${fieldLabel} is required`);
  } else if (name.length < VALIDATION_LIMITS.nameMinLength) {
    errors.push(`${fieldLabel} must be at least ${VALIDATION_LIMITS.nameMinLength} character`);
  } else if (name.length > VALIDATION_LIMITS.nameMaxLength) {
    errors.push(`${fieldLabel} must be less than ${VALIDATION_LIMITS.nameMaxLength} characters`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate date of birth (must be in the past)
 */
export function validateDob(dob: string): ValidationResult {
  const errors: string[] = [];
  
  if (!dob) {
    return { valid: true, errors: [] }; // Often optional
  }
  
  if (!VALIDATION_PATTERNS.date.test(dob)) {
    errors.push('Please enter a valid date (YYYY-MM-DD)');
  } else {
    const date = new Date(dob);
    const today = new Date();
    
    if (isNaN(date.getTime())) {
      errors.push('Please enter a valid date');
    } else if (date >= today) {
      errors.push('Date of birth must be in the past');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate guardian/delegate information
 */
export interface GuardianData {
  delegate_firstName?: string;
  delegate_lastName?: string;
  delegate_email?: string;
  delegate_phone?: string;
  delegate_relationship?: string;
}

export function validateGuardianInfo(data: GuardianData): ValidationResult {
  const errors: string[] = [];
  
  const firstNameResult = validateName(data.delegate_firstName || '', 'First name');
  const lastNameResult = validateName(data.delegate_lastName || '', 'Last name');
  const emailResult = validateEmail(data.delegate_email || '');
  const phoneResult = validatePhone(data.delegate_phone || '');
  
  errors.push(...firstNameResult.errors);
  errors.push(...lastNameResult.errors);
  errors.push(...emailResult.errors);
  errors.push(...phoneResult.errors);
  
  if (!data.delegate_relationship) {
    errors.push('Relationship to participant is required');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate participant information
 */
export interface ParticipantData {
  firstName?: string;
  lastName?: string;
  dob?: string;
}

export function validateParticipantInfo(data: ParticipantData): ValidationResult {
  const errors: string[] = [];
  
  const firstNameResult = validateName(data.firstName || '', 'Participant first name');
  const lastNameResult = validateName(data.lastName || '', 'Participant last name');
  const dobResult = validateDob(data.dob || '');
  
  errors.push(...firstNameResult.errors);
  errors.push(...lastNameResult.errors);
  errors.push(...dobResult.errors);
  
  return { valid: errors.length === 0, errors };
}

/**
 * Check if all participants are valid
 */
export function validateAllParticipants(participants: ParticipantData[]): ValidationResult {
  const allErrors: string[] = [];
  
  if (participants.length === 0) {
    allErrors.push('At least one participant is required');
  }
  
  participants.forEach((p, index) => {
    const result = validateParticipantInfo(p);
    if (!result.valid) {
      allErrors.push(`Participant ${index + 1}: ${result.errors.join(', ')}`);
    }
  });
  
  return { valid: allErrors.length === 0, errors: allErrors };
}
