import { describe, expect, it } from "vitest";
import APIOrchestrator from "../mcp_server/ai/APIOrchestrator";

type RequiredField = {
  key: string;
  label: string;
  required: boolean;
};

type Step2Context = {
  formData: Record<string, unknown>;
  requiredFields: {
    delegate: RequiredField[];
    participant: RequiredField[];
  };
  pendingDelegateInfo?: Record<string, unknown>;
  childInfo?: Record<string, unknown>;
};

type Step2Parser = {
  hydrateFormDataFromText(input: string, context: Step2Context): Record<string, unknown>;
};

function makeOrchestrator() {
  return new APIOrchestrator({}) as unknown as Step2Parser;
}

function makeContext(formData: Record<string, unknown> = {}): Step2Context {
  return {
    formData,
    requiredFields: {
      delegate: [
        { key: "delegate_email", label: "Email", required: true },
        { key: "delegate_firstName", label: "First name", required: true },
        { key: "delegate_lastName", label: "Last name", required: true },
        { key: "delegate_dob", label: "Date of birth", required: true },
        { key: "delegate_relationship", label: "Relationship", required: true },
      ],
      participant: [
        { key: "firstName", label: "First name", required: true },
        { key: "lastName", label: "Last name", required: true },
        { key: "dob", label: "Date of birth", required: true },
      ],
    },
  };
}

describe("register_for_activity Step 2 chat parser", () => {
  it("hydrates reviewer-style account-holder labels with mixed-case names", () => {
    const orchestrator = makeOrchestrator();
    const context = makeContext();

    const formData = orchestrator.hydrateFormDataFromText(
      "Account holder First name: OpenAI, Account holder Last name: Reviewer, Account holder Date of birth: 01/01/1990",
      context
    );

    expect(formData).toMatchObject({
      delegate_firstName: "OpenAI",
      delegate_lastName: "Reviewer",
      delegate_dob: "1990-01-01",
    });
    expect(formData.delegate_relationship).toBeUndefined();
  });

  it("maps bare first and last name follow-ups to the still-missing account holder", () => {
    const orchestrator = makeOrchestrator();
    const context = makeContext({
      delegate_email: "openai-reviewer@example.com",
      delegate_dob: "1990-01-01",
      delegate_relationship: "parent",
    });

    const formData = orchestrator.hydrateFormDataFromText("First name: OpenAI\nLast name: Reviewer", context);

    expect(formData).toMatchObject({
      delegate_email: "openai-reviewer@example.com",
      delegate_firstName: "OpenAI",
      delegate_lastName: "Reviewer",
      delegate_dob: "1990-01-01",
      delegate_relationship: "parent",
    });
    expect(formData.firstName).toBeUndefined();
    expect(formData.lastName).toBeUndefined();
  });

  it("hydrates the full one-message reviewer payload without mixing parent and participant", () => {
    const orchestrator = makeOrchestrator();
    const context = makeContext();

    const formData = orchestrator.hydrateFormDataFromText(
      "Email: openai-reviewer@example.com; Name: OpenAI Reviewer; DOB: 01/01/1990; Relationship: Parent; Participant: Review Child; Participant DOB: 11/26/2014",
      context
    );

    expect(formData).toMatchObject({
      delegate_email: "openai-reviewer@example.com",
      delegate_firstName: "OpenAI",
      delegate_lastName: "Reviewer",
      delegate_dob: "1990-01-01",
      delegate_relationship: "parent",
      firstName: "Review",
      lastName: "Child",
      dob: "2014-11-26",
    });
  });

  it("accepts natural-language first and last name follow-ups", () => {
    const orchestrator = makeOrchestrator();
    const context = makeContext({
      delegate_email: "openai-reviewer@example.com",
      delegate_dob: "1990-01-01",
      delegate_relationship: "parent",
    });

    const formData = orchestrator.hydrateFormDataFromText(
      "My first name is OpenAI and my last name is Reviewer.",
      context
    );

    expect(formData.delegate_firstName).toBe("OpenAI");
    expect(formData.delegate_lastName).toBe("Reviewer");
    expect(formData.firstName).toBeUndefined();
    expect(formData.lastName).toBeUndefined();
  });
});
