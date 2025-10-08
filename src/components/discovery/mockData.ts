import { PrerequisiteCheck } from './useDiscoveryHelpers';
import { ProgramQuestion } from '@/components/ProgramQuestionsPanel';

/**
 * Mock prerequisite checks for testing - all passed
 */
export const mockPrerequisiteChecksAllPassed: PrerequisiteCheck[] = [
  {
    check: 'account_active',
    status: 'pass',
    message: 'Your account is active and in good standing',
  },
  {
    check: 'membership_current',
    status: 'pass',
    message: 'Your membership is valid through December 2025',
  },
  {
    check: 'payment_method',
    status: 'pass',
    message: 'Valid payment method on file (Visa ending in 4242)',
  },
  {
    check: 'waiver_signed',
    status: 'pass',
    message: 'All required waivers signed on 01/15/2025',
  },
];

/**
 * Mock prerequisite checks - some failed
 */
export const mockPrerequisiteChecksSomeFailed: PrerequisiteCheck[] = [
  {
    check: 'account_active',
    status: 'pass',
    message: 'Your account is active',
  },
  {
    check: 'membership_current',
    status: 'fail',
    message: 'Your membership expired on 01/15/2025. Please renew to continue.',
  },
  {
    check: 'payment_method',
    status: 'fail',
    message: 'No valid payment method found. Please add a payment method.',
  },
  {
    check: 'waiver_signed',
    status: 'pass',
    message: 'Waiver signed on 12/20/2024',
  },
];

/**
 * Mock prerequisite checks - checking in progress
 */
export const mockPrerequisiteChecksChecking: PrerequisiteCheck[] = [
  {
    check: 'account_active',
    status: 'pass',
    message: 'Account verified',
  },
  {
    check: 'membership_current',
    status: 'unknown',
    message: 'Checking membership status...',
  },
  {
    check: 'payment_method',
    status: 'unknown',
  },
  {
    check: 'waiver_signed',
    status: 'unknown',
  },
];

/**
 * Mock program questions for testing
 */
export const mockProgramQuestions: ProgramQuestion[] = [
  {
    id: 'skill_level',
    label: 'Skill Level',
    type: 'select',
    options: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
      { value: 'expert', label: 'Expert' }
    ],
    required: true,
    description: 'Select your current skiing/snowboarding skill level',
  },
  {
    id: 'equipment_rental',
    label: 'Equipment Rental',
    type: 'radio',
    options: [
      { value: 'own', label: 'Own Equipment' },
      { value: 'full_rental', label: 'Full Rental (Skis/Board + Boots)' },
      { value: 'boots_only', label: 'Boots Only' }
    ],
    required: true,
  },
  {
    id: 'lesson_preference',
    label: 'Lesson Preference',
    type: 'select',
    options: [
      { value: 'group', label: 'Group Lesson' },
      { value: 'private', label: 'Private Lesson' },
      { value: 'none', label: 'No Lesson' }
    ],
    required: false,
  },
  {
    id: 'emergency_contact',
    label: 'Emergency Contact Name',
    type: 'text',
    required: true,
    description: 'Name of person to contact in case of emergency',
  },
  {
    id: 'emergency_phone',
    label: 'Emergency Contact Phone',
    type: 'text',
    required: true,
    description: '10-digit phone number',
  },
  {
    id: 'medical_conditions',
    label: 'Medical Conditions or Allergies',
    type: 'textarea',
    required: false,
    description: 'Please list any medical conditions or allergies we should be aware of',
  },
  {
    id: 'photo_consent',
    label: 'Photo and Video Consent',
    type: 'checkbox',
    required: true,
    description: 'I consent to photos and videos being taken during program activities',
  },
  {
    id: 'preferred_start_date',
    label: 'Preferred Start Date',
    type: 'date',
    required: false,
    description: 'Select your preferred program start date',
  },
];

/**
 * Mock program questions - minimal set
 */
export const mockProgramQuestionsMinimal: ProgramQuestion[] = [
  {
    id: 'skill_level',
    label: 'Skill Level',
    type: 'select',
    options: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' }
    ],
    required: true,
  },
  {
    id: 'waiver_agreement',
    label: 'Liability Waiver',
    type: 'checkbox',
    required: true,
    description: 'I agree to the terms and conditions',
  },
];

/**
 * Sample answers for mock questions
 */
export const mockProgramAnswers = {
  skill_level: 'intermediate',
  equipment_rental: 'own',
  lesson_preference: 'group',
  emergency_contact: 'Jane Smith',
  emergency_phone: '555-123-4567',
  medical_conditions: 'None',
  photo_consent: true,
};
