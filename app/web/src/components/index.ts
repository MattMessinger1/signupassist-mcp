/**
 * Component Exports
 * 
 * Barrel export for all ChatGPT Apps SDK widget components
 */

// Auth
export { AuthCheck } from './AuthCheck';

// Forms
export { MultiStepRegistrationForm } from './MultiStepRegistrationForm';
export { ParticipantInfoStep } from './form/ParticipantInfoStep';
export { GuardianInfoStep } from './form/GuardianInfoStep';
export { PaymentStep } from './form/PaymentStep';
export { ReviewStep } from './form/ReviewStep';
export { ConfirmationStep } from './form/ConfirmationStep';
export { MandateConsent } from './form/MandateConsent';

// Program Discovery
export { ProgramSelector } from './ProgramSelector';
export type { ProgramSelectorPayload } from './ProgramSelector';

// Provider Connection
export { ProviderConnect } from './ProviderConnect';
export type { ProviderConnectProps } from './ProviderConnect';

// UI Primitives
export * from './ui/primitives';
export { FeeBreakdown } from './ui/FeeBreakdown';
export { StepIndicator } from './ui/StepIndicator';
export { TrustCallout } from './ui/TrustCallout';
export { PrerequisitesCard } from './ui/PrerequisitesCard';
export { OpenTimePicker } from './ui/OpenTimePicker';
