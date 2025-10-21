/**
 * Parse and format MCP tool responses into structured assistant messages
 * Maps backend data to appropriate UI components (carousel, form, confirmation, etc.)
 */

export interface ParsedResponse {
  text: string;
  componentType?: "confirmation" | "carousel" | "form" | "status";
  componentData?: any;
}

/**
 * Parse login response
 */
export function parseLoginResponse(result: any, email: string): ParsedResponse {
  if (result.success) {
    return {
      text: `✅ Successfully logged in as **${email}**. Let's continue with your registration.`,
    };
  } else {
    return {
      text: `❌ Login failed: ${result.error || "Unknown error"}. Please check your credentials and try again.`,
    };
  }
}

/**
 * Parse program search results
 */
export function parseProgramSearchResponse(result: any, query: string): ParsedResponse {
  // Extract programs from result
  // In real implementation, parse result.data or result.programs
  const programs = result.programs || result.data?.programs || [];

  if (programs.length === 0) {
    return {
      text: `I couldn't find any programs matching "${query}". Try a different search term or browse all available programs.`,
    };
  }

  if (programs.length === 1) {
    return {
      text: `I found **1 program** that matches your search. Would you like to proceed with this option?`,
      componentType: "carousel",
      componentData: { options: programs },
    };
  }

  return {
    text: `I found **${programs.length} programs** that match your search. Please select the one you're interested in:`,
    componentType: "carousel",
    componentData: { options: programs },
  };
}

/**
 * Parse program selection and format confirmation
 */
export function parseProgramSelectionResponse(
  program: any,
  prerequisites?: any
): ParsedResponse {
  const prereqText = prerequisites?.required?.length
    ? `\n\n**Prerequisites needed:**\n${prerequisites.required.map((p: any) => `• ${p}`).join("\n")}`
    : "";

  return {
    text: `Great choice! Let me prepare your registration for **${program.title}**.${prereqText}\n\nPlease review the details and confirm to proceed:`,
    componentType: "confirmation",
    componentData: {
      title: "Confirm Registration",
      message: formatProgramDetails(program),
    },
  };
}

/**
 * Parse prerequisite check results
 */
export function parsePrerequisiteResponse(result: any, hasSession: boolean): ParsedResponse {
  const statuses = [
    { label: "Account Login", status: hasSession ? "done" : "pending" },
    { label: "Waiver Signed", status: result.waiver_signed ? "done" : "pending" },
    { label: "Payment Info", status: result.payment_info ? "done" : "pending" },
    { label: "Emergency Contact", status: result.emergency_contact ? "done" : "pending" },
  ];

  const pendingCount = statuses.filter((s) => s.status === "pending").length;

  if (pendingCount === 0) {
    return {
      text: "✅ All prerequisites are complete! You're ready to register.",
      componentType: "status",
      componentData: { statuses },
    };
  }

  return {
    text: `Let's check your registration requirements. You have **${pendingCount} item${pendingCount > 1 ? "s" : ""}** to complete:`,
    componentType: "status",
    componentData: { statuses },
  };
}

/**
 * Format form request based on missing prerequisites
 */
export function formatFormRequest(missingPrereqs: string[]): ParsedResponse {
  if (missingPrereqs.includes("login")) {
    return {
      text: "I need your login credentials to proceed. Please sign in to continue:",
      componentType: "form",
      componentData: {
        title: "Login Required",
        fields: [
          { id: "email", label: "Email", type: "text", required: true },
          { id: "password", label: "Password", type: "password", required: true },
        ],
      },
    };
  }

  // Default registration details form
  return {
    text: "Please provide the following information to complete your registration:",
    componentType: "form",
    componentData: {
      title: "Registration Details",
      fields: [
        { id: "childName", label: "Child's Full Name", type: "text", required: true },
        { id: "emergencyContact", label: "Emergency Contact Phone", type: "text", required: true },
        { id: "waiver", label: "I agree to the terms and waiver", type: "checkbox", required: true },
      ],
    },
  };
}

/**
 * Parse registration submission result
 */
export function parseRegistrationResponse(result: any, childName: string): ParsedResponse {
  if (result.success) {
    return {
      text: `🎉 **Registration Complete!**

Your registration for **${childName}** has been successfully submitted.

**What happens next:**
• You'll receive a confirmation email shortly
• Payment (if required) will be processed
• Check your account for further instructions

Thank you for using our registration service!`,
    };
  }

  return {
    text: `❌ Registration failed: ${result.error || "Unknown error"}. Please try again or contact support.`,
  };
}

/**
 * Format program details for display
 */
function formatProgramDetails(program: any): string {
  const parts = [
    `**Program:** ${program.title}`,
    program.description ? `**Description:** ${program.description}` : "",
    program.price ? `**Price:** ${formatPrice(program.price)}` : "",
    program.schedule ? `**Schedule:** ${program.schedule}` : "",
    program.location ? `**Location:** ${program.location}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

/**
 * Format price display
 */
function formatPrice(price: number | string): string {
  if (typeof price === "number") {
    return `$${price}`;
  }
  return price;
}

/**
 * Format error response
 */
export function formatErrorResponse(error: string, context?: string): ParsedResponse {
  const contextText = context ? ` while ${context}` : "";
  return {
    text: `❌ **Error${contextText}**

${error}

Please try again or contact support if the problem persists.`,
  };
}
