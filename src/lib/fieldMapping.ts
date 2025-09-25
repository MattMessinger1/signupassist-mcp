/**
 * Field Mapping and Validation System
 * Ensures seamless integration between frontend field discovery and backend automation
 */

import { EnhancedDiscoveredField } from '@/components/FieldRenderer';

export interface BackendFieldSchema {
  program_ref: string;
  branches: Array<{
    choice: string;
    questions: Array<{
      id: string;
      label: string;
      type: string;
      required: boolean;
      options?: string[];
    }>;
  }>;
  common_questions?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
}

export interface MappedFieldData {
  answers: Record<string, any>;
  child_info: {
    name: string;
    dob: string;
  };
  validation_errors: string[];
  coverage_report: {
    total_required_fields: number;
    covered_required_fields: number;
    coverage_percentage: number;
    missing_required_fields: string[];
  };
}

/**
 * Maps frontend form data to backend-compatible format
 */
export function mapFormDataToBackend(
  formData: {
    answers: Record<string, any>;
    childId: string;
    selectedBranch: string;
  },
  discoveredSchema: BackendFieldSchema,
  childData: { name: string; dob: string }
): MappedFieldData {
  const mappedAnswers: Record<string, any> = {};
  const validationErrors: string[] = [];

  // Get relevant fields based on selected branch
  const selectedBranch = discoveredSchema.branches.find(b => 
    b.choice === formData.selectedBranch || 
    b.choice.includes(formData.selectedBranch)
  );
  
  const relevantFields = [
    ...(discoveredSchema.common_questions || []),
    ...(selectedBranch?.questions || [])
  ];

  // Map field values with proper type conversion
  Object.entries(formData.answers || {}).forEach(([frontendFieldId, value]) => {
    const field = relevantFields.find(f => f.id === frontendFieldId);
    
    if (field) {
      // Convert frontend values to backend-compatible format
      const mappedValue = convertFieldValue(value, field.type);
      
      // Use both field.id and field.name for maximum compatibility
      mappedAnswers[field.id] = mappedValue;
      
      // Also map to any alternative field names that might be used in the form
      const altFieldName = generateAlternativeFieldName(field.label);
      if (altFieldName && altFieldName !== field.id) {
        mappedAnswers[altFieldName] = mappedValue;
      }
    } else {
      // Log unmapped fields for debugging
      console.warn(`Unmapped field: ${frontendFieldId} = ${value}`);
      mappedAnswers[frontendFieldId] = value;
    }
  });

  // Validate required fields coverage
  const requiredFields = relevantFields.filter(f => f.required);
  const coveredRequiredFields = requiredFields.filter(f => 
    mappedAnswers.hasOwnProperty(f.id) && 
    mappedAnswers[f.id] !== undefined && 
    mappedAnswers[f.id] !== ''
  );

  const missingRequiredFields = requiredFields
    .filter(f => !coveredRequiredFields.includes(f))
    .map(f => f.label || f.id);

  if (missingRequiredFields.length > 0) {
    validationErrors.push(`Missing required fields: ${missingRequiredFields.join(', ')}`);
  }

  // Add smart field mappings for common patterns
  addSmartFieldMappings(mappedAnswers, childData);

  return {
    answers: mappedAnswers,
    child_info: childData,
    validation_errors: validationErrors,
    coverage_report: {
      total_required_fields: requiredFields.length,
      covered_required_fields: coveredRequiredFields.length,
      coverage_percentage: requiredFields.length > 0 
        ? Math.round((coveredRequiredFields.length / requiredFields.length) * 100)
        : 100,
      missing_required_fields: missingRequiredFields
    }
  };
}

/**
 * Converts frontend field values to backend-compatible format
 */
function convertFieldValue(value: any, fieldType: string): any {
  if (value === undefined || value === null) return '';

  switch (fieldType) {
    case 'checkbox':
      return value === true || value === 'true' || value === 'yes';
    
    case 'multi-select':
      return Array.isArray(value) ? value.join(', ') : value;
    
    case 'date':
      if (typeof value === 'string' && value.includes('T')) {
        // Convert ISO date to MM/DD/YYYY format that forms typically expect
        try {
          const date = new Date(value);
          return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
        } catch {
          return value;
        }
      }
      return value;
    
    case 'number':
      return typeof value === 'string' ? value : value.toString();
    
    default:
      return typeof value === 'string' ? value : value.toString();
  }
}

/**
 * Generates alternative field names based on common patterns
 */
function generateAlternativeFieldName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Adds smart field mappings for common form patterns
 */
function addSmartFieldMappings(answers: Record<string, any>, childData: { name: string; dob: string }): void {
  // Common field name patterns that might be used in SkiClubPro forms
  const commonMappings = {
    // Child name variations
    'child_name': childData.name,
    'participant_name': childData.name,
    'student_name': childData.name,
    'first_name': childData.name.split(' ')[0],
    'last_name': childData.name.split(' ').slice(1).join(' '),
    
    // Date of birth variations
    'dob': childData.dob,
    'date_of_birth': childData.dob,
    'birthdate': childData.dob,
    'birth_date': childData.dob,
    
    // Age calculation if DOB is available
    'age': childData.dob ? calculateAge(childData.dob).toString() : '',
    'child_age': childData.dob ? calculateAge(childData.dob).toString() : '',
  };

  // Only add mappings if they don't already exist
  Object.entries(commonMappings).forEach(([key, value]) => {
    if (!answers.hasOwnProperty(key) && value) {
      answers[key] = value;
    }
  });

  // Add emergency contact defaults if not provided
  if (!answers.emergency_contact && !answers.emergency_contact_name) {
    answers.emergency_contact = 'Parent/Guardian';
    answers.emergency_contact_name = 'Parent/Guardian';
    answers.emergency_relationship = 'Parent';
  }

  // Add reasonable defaults for common fields
  if (!answers.pickup_authorization) {
    answers.pickup_authorization = 'Parent/Guardian Only';
  }

  if (!answers.medical_conditions && !answers.allergies) {
    answers.medical_conditions = 'None';
    answers.allergies = 'None';
  }
}

/**
 * Calculates age from date of birth
 */
function calculateAge(dob: string): number {
  try {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  } catch {
    return 0;
  }
}

/**
 * Validates field mapping completeness before registration
 */
export function validateFieldMapping(
  mappedData: MappedFieldData,
  strictMode: boolean = true
): { isValid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [...mappedData.validation_errors];
  const warnings: string[] = [];

  // Check coverage percentage
  if (mappedData.coverage_report.coverage_percentage < 100) {
    const message = `Only ${mappedData.coverage_report.coverage_percentage}% of required fields are covered`;
    
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  // Check for critical child information
  if (!mappedData.child_info.name) {
    errors.push('Child name is required');
  }

  if (!mappedData.child_info.dob) {
    warnings.push('Child date of birth not provided - age-related validations may fail');
  }

  // Check for minimum viable field set
  const criticalFields = ['child_name', 'participant_name', 'student_name'];
  const hasChildNameField = criticalFields.some(field => 
    mappedData.answers.hasOwnProperty(field) && mappedData.answers[field]
  );

  if (!hasChildNameField) {
    errors.push('No child name field mapping found - registration may fail');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Creates a comprehensive registration payload for the backend
 */
export function createRegistrationPayload(
  planId: string,
  mandateId: string,
  mappedData: MappedFieldData,
  options: {
    sessionRef?: string;
    programRef: string;
    childId: string;
  }
) {
  return {
    session_ref: options.sessionRef,
    program_ref: options.programRef,
    child_id: options.childId,
    answers: mappedData.answers,
    mandate_id: mandateId,
    plan_execution_id: planId,
    
    // Additional metadata for debugging and audit
    _metadata: {
      field_coverage: mappedData.coverage_report,
      mapping_warnings: mappedData.validation_errors,
      child_info: mappedData.child_info,
      timestamp: new Date().toISOString()
    }
  };
}