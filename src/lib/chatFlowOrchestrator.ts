/**
 * Chat Flow Orchestrator
 * 
 * Manages the flow of the signup conversation including:
 * - Tool call coordination
 * - Response parsing
 * - State management helpers
 * - Flow validation
 * 
 * This makes the flow logic reusable and extensible for new providers/flows.
 */

import {
  mcpLogin,
  mcpFindPrograms,
  mcpCheckPrerequisites,
} from "@/lib/chatMcpClient";
import {
  parseLoginResponse,
  parseProgramSearchResponse,
  parseProgramSelectionResponse,
  parsePrerequisiteResponse,
  formatFormRequest,
  parseRegistrationResponse,
  formatErrorResponse,
} from "@/lib/chatResponseParser";
import { DEFAULT_PROVIDER, MOCK_PROGRAMS } from "@/lib/config/testHarness";
import type { LogLevel, LogCategory } from "@/lib/debugLogger";

export interface OrchestratorContext {
  orgRef: string;
  sessionRef?: string;
  selectedProgram?: any;
  addLog: (level: LogLevel, category: LogCategory, message: string, data?: any) => void;
}

export interface OrchestratorResult {
  success: boolean;
  text: string;
  componentType?: "confirmation" | "carousel" | "form" | "status";
  componentData?: any;
  stateUpdate?: Record<string, any>;
  error?: string;
}

/**
 * Execute login flow
 */
export async function executeLogin(
  email: string,
  password: string,
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  context.addLog("info", "tool", "Calling mcpLogin", { email, orgRef: context.orgRef });
  
  try {
    const loginResult = await mcpLogin(email, password, context.orgRef);
    
    context.addLog(
      loginResult.success ? "success" : "error",
      "tool",
      "mcpLogin response received",
      { success: loginResult.success }
    );

    if (!loginResult.success) {
      const errorResponse = formatErrorResponse(
        loginResult.error || "Login failed",
        "logging in"
      );
      return {
        success: false,
        text: errorResponse.text,
        error: loginResult.error,
      };
    }

    const response = parseLoginResponse(loginResult, email);
    return {
      success: true,
      text: response.text,
      stateUpdate: { sessionRef: loginResult.session_ref },
    };
  } catch (error) {
    const errorResponse = formatErrorResponse(
      error instanceof Error ? error.message : "Unknown error",
      "logging in"
    );
    return {
      success: false,
      text: errorResponse.text,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute program search flow
 */
export async function executeSearch(
  query: string,
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  context.addLog("info", "tool", "Calling mcpFindPrograms", { orgRef: context.orgRef, query });
  
  try {
    const result = await mcpFindPrograms(context.orgRef, query);
    
    context.addLog("success", "tool", "mcpFindPrograms response received", { success: result.success });

    if (!result.success) {
      const errorResponse = formatErrorResponse(
        result.error || "Failed to search programs",
        "searching for programs"
      );
      return {
        success: false,
        text: errorResponse.text,
        error: result.error,
      };
    }

    // Use mock programs for demo (in production, use result.data)
    const programs = MOCK_PROGRAMS;
    const response = parseProgramSearchResponse({ programs }, query);

    return {
      success: true,
      text: response.text,
      componentType: response.componentType,
      componentData: response.componentData,
    };
  } catch (error) {
    const errorResponse = formatErrorResponse(
      error instanceof Error ? error.message : "Unknown error",
      "searching for programs"
    );
    return {
      success: false,
      text: errorResponse.text,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute program selection flow
 */
export async function executeProgramSelect(
  program: any,
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  context.addLog("info", "tool", "Calling mcpCheckPrerequisites", {
    orgRef: context.orgRef,
    programId: program.id,
  });
  
  try {
    const prereqResult = await mcpCheckPrerequisites(context.orgRef, program.id);
    
    context.addLog("success", "tool", "mcpCheckPrerequisites response received", {
      success: prereqResult.success,
    });

    if (!prereqResult.success) {
      const errorResponse = formatErrorResponse(
        prereqResult.error || "Failed to check prerequisites",
        "checking prerequisites"
      );
      return {
        success: false,
        text: errorResponse.text,
        error: prereqResult.error,
      };
    }

    const response = parseProgramSelectionResponse(program, prereqResult.data);
    
    return {
      success: true,
      text: response.text,
      componentType: response.componentType,
      componentData: response.componentData,
      stateUpdate: { selectedProgram: program },
    };
  } catch (error) {
    const errorResponse = formatErrorResponse(
      error instanceof Error ? error.message : "Unknown error",
      "selecting program"
    );
    return {
      success: false,
      text: errorResponse.text,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute prerequisite check flow
 */
export async function executePrerequisiteCheck(
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  context.addLog("info", "tool", "Calling mcpCheckPrerequisites", { orgRef: context.orgRef });
  
  try {
    const prereqResult = await mcpCheckPrerequisites(context.orgRef);
    
    context.addLog("success", "tool", "mcpCheckPrerequisites response received", {
      success: prereqResult.success,
    });

    if (!prereqResult.success) {
      const errorResponse = formatErrorResponse(
        prereqResult.error || "Failed to check prerequisites",
        "checking prerequisites"
      );
      return {
        success: false,
        text: errorResponse.text,
        error: prereqResult.error,
      };
    }

    const response = parsePrerequisiteResponse(prereqResult.data || {}, !!context.sessionRef);

    // Determine what's missing
    const missingPrereqs = [];
    if (!context.sessionRef) missingPrereqs.push("login");
    if (!prereqResult.data?.waiver_signed) missingPrereqs.push("waiver");
    if (!prereqResult.data?.emergency_contact) missingPrereqs.push("emergency_contact");

    return {
      success: true,
      text: response.text,
      componentType: response.componentType,
      componentData: response.componentData,
      stateUpdate: { missingPrereqs },
    };
  } catch (error) {
    const errorResponse = formatErrorResponse(
      error instanceof Error ? error.message : "Unknown error",
      "checking prerequisites"
    );
    return {
      success: false,
      text: errorResponse.text,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute registration submission
 */
export async function executeRegistration(
  childName: string,
  context: OrchestratorContext
): Promise<OrchestratorResult> {
  context.addLog("info", "tool", "Simulating registration submission", { childName });
  
  try {
    // TODO: Replace with actual MCP registration call
    const mockResult = { success: true };
    
    context.addLog("success", "tool", "Registration submission successful");
    
    const response = parseRegistrationResponse(mockResult, childName);
    
    return {
      success: true,
      text: response.text,
      stateUpdate: { registrationRef: `REG-${Date.now()}` },
    };
  } catch (error) {
    const errorResponse = formatErrorResponse(
      error instanceof Error ? error.message : "Unknown error",
      "submitting registration"
    );
    return {
      success: false,
      text: errorResponse.text,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Validate if a flow can proceed based on required state
 */
export function canProceedWithFlow(
  flowType: "search" | "select" | "register",
  context: OrchestratorContext
): { canProceed: boolean; missingRequirements: string[] } {
  const missing: string[] = [];

  switch (flowType) {
    case "search":
      if (!context.sessionRef) missing.push("sessionRef (login required)");
      break;
    case "select":
      if (!context.sessionRef) missing.push("sessionRef (login required)");
      break;
    case "register":
      if (!context.sessionRef) missing.push("sessionRef (login required)");
      if (!context.selectedProgram) missing.push("selectedProgram (program selection required)");
      break;
  }

  return {
    canProceed: missing.length === 0,
    missingRequirements: missing,
  };
}
