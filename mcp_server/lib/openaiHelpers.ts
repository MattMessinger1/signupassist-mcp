/**
 * OpenAI API Helper - Temperature-safe calls for all models
 * Automatically handles models that don't support custom temperature values
 */

import OpenAI from "openai";

// Models that reject or ignore non-default temperature
const FIXED_TEMP_PATTERNS = [
  /^gpt-5($|[-.])/i,
  /^gpt-5-mini($|[-.])/i,
  /^gpt-5-vision($|[-.])/i,
  /^o3($|[-.])/i,
  /^o4-mini($|[-.])/i
];

// Allow ops to force-list via env (CSV)
const FIXED_TEMP_EXTRA = (process.env.OPENAI_FIXED_TEMP_MODELS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function isFixedTemp(model: string): boolean {
  if (FIXED_TEMP_EXTRA.includes(model)) return true;
  return FIXED_TEMP_PATTERNS.some(re => re.test(model));
}

// Remove params some models don't support; also map tokens key for Responses vs Chat
export function sanitizeModelParams(model: string, params: Record<string, any>) {
  const p = { ...params };

  // Temperature: drop or coerce when the model has fixed temp
  if (isFixedTemp(model)) {
    delete p.temperature;  // let server default to 1
  } else {
    // Optional: allow env to set a default for non-fixed models
    const envTemp = process.env.OPENAI_TEMPERATURE;
    if (envTemp && p.temperature === undefined) {
      p.temperature = Number(envTemp);
    }
  }

  // Normalize tokens key depending on endpoint (Responses vs Chat)
  if (p.useResponsesAPI) {
    if (p.max_tokens && !p.max_output_tokens) {
      p.max_output_tokens = p.max_tokens;
    }
    delete p.max_tokens;
  } else {
    if (p.max_output_tokens && !p.max_tokens) {
      p.max_tokens = p.max_output_tokens;
    }
    delete p.max_output_tokens;
  }

  return p;
}

// Generic JSON call that works with either Responses API or Chat Completions
export async function callOpenAI_JSON(opts: {
  model: string;
  system: string;
  user: any; // object to serialize
  maxTokens?: number;
  temperature?: number;
  useResponsesAPI?: boolean; // default true
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const {
    model,
    system,
    user,
    maxTokens = 1200,
    temperature,
    useResponsesAPI = process.env.OPENAI_USE_RESPONSES !== "false"
  } = opts;

  const baseParams: Record<string, any> = {
    model,
    temperature,
    max_output_tokens: maxTokens,
    useResponsesAPI
  };

  const params = sanitizeModelParams(model, baseParams);

  try {
    if (useResponsesAPI) {
      // Responses API (preferred)
      const res = await openai.responses.create({
        model: params.model,
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ],
        response_format: { type: "json_object" },
        max_output_tokens: params.max_output_tokens
      } as any);
      
      // In SDK v4, safest is output_text for JSON and then parse
      const text = (res as any).output_text ?? (res as any).output?.[0]?.content?.[0]?.text;
      return text ? JSON.parse(text) : {};
    } else {
      // Chat Completions fallback
      const res = await openai.chat.completions.create({
        model: params.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ],
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        response_format: { type: "json_object" as const }
      });
      const text = res.choices?.[0]?.message?.content || "{}";
      return JSON.parse(text);
    }
  } catch (err: any) {
    // If model rejects temperature again for any reason, strip & retry once
    const msg = String(err?.message || err);
    const param = err?.error?.param || err?.param;
    const code = err?.error?.code || err?.code;

    const isTempIssue =
      /Unsupported value.*temperature/i.test(msg) ||
      (code === "unsupported_value" && param === "temperature");

    if (isTempIssue) {
      console.warn('[openaiHelpers] Temperature issue detected, retrying without temperature...');
      
      // Retry with temp removed and default tokens
      if (useResponsesAPI) {
        const res = await openai.responses.create({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(user) }
          ],
          response_format: { type: "json_object" }
        } as any);
        const text = (res as any).output_text ?? (res as any).output?.[0]?.content?.[0]?.text;
        return text ? JSON.parse(text) : {};
      } else {
        const res = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(user) }
          ],
          response_format: { type: "json_object" as const }
        });
        const text = res.choices?.[0]?.message?.content || "{}";
        return JSON.parse(text);
      }
    }

    // Propagate non-temperature errors
    throw err;
  }
}
