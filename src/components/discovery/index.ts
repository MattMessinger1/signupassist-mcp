export { StatusIcon } from './StatusIcon';
export type { StatusIconProps } from './StatusIcon';

export {
  useDiscoveryHelpers,
  humanizeFieldName,
  allPassed,
  anyFailed,
  isChecking,
  getCheckSummary,
} from './useDiscoveryHelpers';
export type { PrerequisiteCheck } from './useDiscoveryHelpers';

export {
  mockPrerequisiteChecksAllPassed,
  mockPrerequisiteChecksSomeFailed,
  mockPrerequisiteChecksChecking,
  mockProgramQuestions,
  mockProgramQuestionsMinimal,
  mockProgramAnswers,
} from './mockData';
