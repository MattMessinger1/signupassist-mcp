/**
 * Claude (Anthropic) API Helper
 * Mirrors openaiHelpers.ts interface for provider-agnostic AI calls
 */

import Anthropic from "@anthropic-ai/sdk";
import { safeJSONParse } from "./openaiHelpers.js";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

/**
 * Claude JSON call - mirrors callOpenAI_JSON interface
 */
export async function callClaude_JSON(opts: {
  model?: string;
  system: string;
  user: any;
  maxTokens?: number;
  temperature?: number;
  _retryCount?: number;
}): Promise<any> {
  const {
    model = DEFAULT_MODEL,
    system,
    user,
    maxTokens = 250,
    temperature = 0,
    _retryCount = 0,
  } = opts;

  const client = getClient();

  // Claude uses system as a top-level param, not a message
  // For JSON output, instruct in the system prompt
  const systemPrompt = system.includes("JSON")
    ? system
    : system + "\n\nReturn your answer strictly as a JSON object.";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: typeof user === "string" ? user : JSON.stringify(user),
        },
      ],
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock?.type === "text" ? textBlock.text : "";

    console.log(`[claudeHelpers] Raw response length: ${text.length} chars`);
    console.log(`[claudeHelpers] First 500 chars: ${text.substring(0, 500)}`);

    // Strip markdown code fences if present (Claude sometimes wraps JSON in ```json...```)
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    const data = safeJSONParse(cleaned);
    if (!data) {
      console.error(`[claudeHelpers] Invalid JSON response:\n${text}`);

      if (_retryCount < 1) {
        console.warn(
          `[claudeHelpers] Retrying API call (attempt ${_retryCount + 2})...`
        );
        await new Promise((r) => setTimeout(r, 1000));
        return callClaude_JSON({ ...opts, _retryCount: _retryCount + 1 });
      }

      throw new Error("Claude returned invalid JSON after 2 attempts");
    }
    return data;
  } catch (err: any) {
    if (err.message?.includes("invalid JSON")) throw err;
    console.error("[claudeHelpers] API call failed:", err.message);
    throw err;
  }
}

/**
 * Claude Text call - plain text completion
 */
export async function callClaude_Text(opts: {
  model?: string;
  system: string;
  user: any;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const {
    model = DEFAULT_MODEL,
    system,
    user,
    maxTokens = 250,
    temperature = 0,
  } = opts;

  const client = getClient();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [
      {
        role: "user",
        content: typeof user === "string" ? user : JSON.stringify(user),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
