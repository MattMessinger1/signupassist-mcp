/**
 * AI Provider Abstraction Layer
 * Dispatches to OpenAI or Claude based on AI_PROVIDER env var
 *
 * Usage: Replace `callOpenAI_JSON` imports with `callAI_JSON` from this module.
 */

import { callOpenAI_JSON } from "./openaiHelpers.js";
import { callClaude_JSON, callClaude_Text } from "./claudeHelpers.js";

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();

/** Model mapping: OpenAI model → Claude equivalent */
const MODEL_MAP: Record<string, string> = {
  "gpt-4o": "claude-sonnet-4-6",
  "gpt-4o-mini": "claude-haiku-4-5-20251001",
  "gpt-5-mini-2025-08-07": "claude-haiku-4-5-20251001",
  "gpt-5.1": "claude-sonnet-4-6",
  "gpt-5.1-mini": "claude-haiku-4-5-20251001",
};

function mapModel(openaiModel: string): string {
  if (AI_PROVIDER !== "claude") return openaiModel;
  return (
    process.env.CLAUDE_MODEL ||
    MODEL_MAP[openaiModel] ||
    "claude-sonnet-4-6"
  );
}

/**
 * Provider-agnostic JSON call.
 * Same signature as callOpenAI_JSON — drop-in replacement.
 */
export async function callAI_JSON(opts: {
  model: string;
  system: string;
  user: any;
  maxTokens?: number;
  temperature?: number;
  useResponsesAPI?: boolean;
  _retryCount?: number;
}): Promise<any> {
  if (AI_PROVIDER === "claude") {
    return callClaude_JSON({
      ...opts,
      model: mapModel(opts.model),
    });
  }
  return callOpenAI_JSON(opts);
}

/**
 * Provider-agnostic text call.
 */
export async function callAI_Text(opts: {
  model: string;
  system: string;
  user: any;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  if (AI_PROVIDER === "claude") {
    return callClaude_Text({
      ...opts,
      model: mapModel(opts.model),
    });
  }
  // For OpenAI text calls, use the JSON call and extract
  // (openaiHelpers doesn't export a dedicated text function)
  const result = await callOpenAI_JSON({
    ...opts,
    system: opts.system + "\nReturn plain text, not JSON.",
  });
  return typeof result === "string" ? result : JSON.stringify(result);
}

/** Expose current provider for logging/diagnostics */
export function getAIProvider(): string {
  return AI_PROVIDER;
}
