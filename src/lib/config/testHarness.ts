/**
 * Test Harness Configuration
 * 
 * Centralized configuration for the ChatTestHarness including:
 * - Test data for automated flows
 * - Provider configurations
 * - Flow definitions
 * - Environment settings
 */

// ============= Test Data =============

export const TEST_CREDENTIALS = {
  email: "test@example.com",
  password: "testpass123",
} as const;

export const TEST_SEARCH_QUERIES = {
  skiLessons: "ski lessons for kids",
  snowboarding: "snowboarding programs",
  general: "winter programs",
} as const;

export const TEST_CHILD_INFO = {
  childName: "Alex Johnson",
  age: 8,
  emergencyContact: "555-0123",
  waiver: true,
} as const;

export const DEMO_TEST_DATA = {
  credentials: TEST_CREDENTIALS,
  searchQuery: TEST_SEARCH_QUERIES.skiLessons,
  childInfo: TEST_CHILD_INFO,
} as const;

// ============= Provider Configuration =============

export const PROVIDERS = {
  skiclubpro: {
    id: "skiclubpro",
    name: "SkiClubPro",
    defaultOrg: "blackhawk-ski-club",
    tools: {
      login: "skiclubpro_login",
      findPrograms: "skiclubpro_find_programs",
      checkPrerequisites: "skiclubpro_check_prerequisites",
      register: "skiclubpro_register",
    },
  },
  // Future providers can be added here
} as const;

export const DEFAULT_PROVIDER = PROVIDERS.skiclubpro;

// ============= Mock Data =============

/**
 * Mock programs for testing when backend is unavailable
 * In production, these would come from the MCP server
 */
export const MOCK_PROGRAMS = [
  { 
    id: "ski-l1", 
    title: "Ski Lessons - Level 1", 
    description: "Beginner slopes, Ages 6-10",
    price: 120,
    schedule: "Saturdays 9am-12pm"
  },
  { 
    id: "ski-l2", 
    title: "Ski Lessons - Level 2", 
    description: "Intermediate, Ages 8-14",
    price: 150,
    schedule: "Saturdays 1pm-4pm"
  },
  { 
    id: "snowboard-101", 
    title: "Snowboarding 101", 
    description: "Beginner course, Ages 10+",
    price: 140,
    schedule: "Sundays 10am-1pm"
  },
] as const;

/**
 * Mock prerequisite statuses for testing
 */
export const MOCK_PREREQUISITE_STATUSES = [
  { label: "Account Login", status: "done" as const },
  { label: "Waiver Signed", status: "pending" as const },
  { label: "Payment Info", status: "pending" as const },
  { label: "Emergency Contact", status: "pending" as const },
];

// ============= Flow Configuration =============

/**
 * Flow step definitions
 * This makes the flow data-driven and easier to extend
 */
export type FlowStep = 
  | "welcome"
  | "login"
  | "search"
  | "select"
  | "prerequisites"
  | "form"
  | "confirm"
  | "complete";

export interface FlowStepConfig {
  id: FlowStep;
  name: string;
  description: string;
  requiredState?: string[]; // State keys that must be present
  nextStep?: FlowStep;
  autoAdvance?: boolean; // Whether to automatically advance to next step
}

/**
 * Default signup flow configuration
 * This defines the sequence of steps in a typical signup
 */
export const DEFAULT_FLOW: FlowStepConfig[] = [
  {
    id: "welcome",
    name: "Welcome",
    description: "Initial greeting",
    nextStep: "login",
  },
  {
    id: "login",
    name: "Login",
    description: "User authentication",
    nextStep: "search",
  },
  {
    id: "search",
    name: "Search Programs",
    description: "Find available programs",
    requiredState: ["sessionRef"],
    nextStep: "select",
  },
  {
    id: "select",
    name: "Select Program",
    description: "Choose a program",
    requiredState: ["sessionRef"],
    nextStep: "prerequisites",
  },
  {
    id: "prerequisites",
    name: "Check Prerequisites",
    description: "Verify requirements",
    requiredState: ["sessionRef", "selectedProgram"],
    nextStep: "form",
  },
  {
    id: "form",
    name: "Fill Form",
    description: "Enter registration details",
    requiredState: ["sessionRef", "selectedProgram"],
    nextStep: "confirm",
  },
  {
    id: "confirm",
    name: "Confirm Registration",
    description: "Final confirmation",
    requiredState: ["sessionRef", "selectedProgram"],
    nextStep: "complete",
  },
  {
    id: "complete",
    name: "Complete",
    description: "Registration finished",
    requiredState: ["sessionRef", "selectedProgram", "registrationRef"],
  },
];

// ============= UI Configuration =============

export const UI_CONFIG = {
  maxMessageWidth: "80%",
  scrollBehavior: "smooth" as const,
  animationDelay: {
    short: 800,
    medium: 1500,
    long: 2500,
  },
  colors: {
    user: "primary",
    assistant: "muted",
  },
} as const;

// ============= Environment =============

/**
 * Get environment-specific configuration
 * Reads from environment variables with fallbacks
 */
export function getEnvironmentConfig() {
  return {
    mcpBaseUrl: import.meta.env.VITE_MCP_BASE_URL || "http://localhost:3001",
    debug: import.meta.env.DEV || false,
    autoConnect: import.meta.env.VITE_AUTO_CONNECT_MCP !== "false",
  };
}

// ============= Validation Helpers =============

/**
 * Check if required state keys are present
 */
export function hasRequiredState(state: Record<string, any>, required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.every(key => state[key] !== undefined && state[key] !== null);
}

/**
 * Get the next step in the flow based on current state
 */
export function getNextFlowStep(currentStep: FlowStep, state: Record<string, any>): FlowStep | null {
  const currentConfig = DEFAULT_FLOW.find(step => step.id === currentStep);
  if (!currentConfig?.nextStep) return null;
  
  const nextConfig = DEFAULT_FLOW.find(step => step.id === currentConfig.nextStep);
  if (!nextConfig) return null;
  
  // Check if state requirements are met
  if (!hasRequiredState(state, nextConfig.requiredState)) {
    return null;
  }
  
  return nextConfig.id;
}
