/**
 * OpenAI API Helper - Temperature-safe calls for all models
 * Automatically handles models that don't support custom temperature values
 * Correctly branches Responses API vs Chat Completions parameter families
 */

import OpenAI from "openai";

// Models that reject or ignore non-default temperature
const FIXED_TEMP_PATTERNS = [
  /^gpt-5($|[-.])/i,
  /^gpt-5-mini($|[-.])/i,
  /^gpt-5-vision($|[-.])/i,
  /^o3($|[-.])/i,
  /^o4-mini($|[-.])/i,
  /vision-preview/i  // Vision models don't support custom temperature
];

// Allow ops to force-list via env (CSV)
const FIXED_TEMP_EXTRA = (process.env.OPENAI_FIXED_TEMP_MODELS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/**
 * Check if a model supports custom temperature parameter
 */
export function supportsCustomTemperature(model: string): boolean {
  if (FIXED_TEMP_EXTRA.includes(model)) return false;
  return !FIXED_TEMP_PATTERNS.some(re => re.test(model));
}

/**
 * Newer OpenAI models use max_completion_tokens instead of max_tokens
 * in the Chat Completions API
 */
function requiresCompletionTokensParam(model: string): boolean {
  const newerModelPatterns = [
    /^gpt-5/i,           // All GPT-5 variants
    /^gpt-4\.1/i,        // GPT-4.1 family
    /^o3/i,              // O3 reasoning models
    /^o4/i,              // O4 reasoning models
  ];
  
  return newerModelPatterns.some(pattern => pattern.test(model));
}

/**
 * Ensures at least one message contains the word "json" when using JSON response format
 * OpenAI requires this for response_format: { type: 'json_object' }
 */
function ensureJsonWord(messages: Array<{ role: string; content: any }>): Array<{ role: string; content: any }> {
  const hasJson = messages.some((m) => /json/i.test(String(m.content)));
  if (!hasJson) {
    const cloned = structuredClone(messages);
    const lastIdx = cloned.length - 1;
    cloned[lastIdx] = {
      ...cloned[lastIdx],
      content:
        String(cloned[lastIdx].content) +
        '\n\nYou MUST respond with a JSON object only. Return valid JSON.',
    };
    return cloned;
  }
  return messages;
}

/**
 * Safe JSON parser with automatic cleanup and retry
 * Prevents crashes from malformed JSON responses
 */
export function safeJSONParse<T = any>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("[openaiHelpers] JSON parse failed, trimming + retrying...");
    const fixed = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
    try { 
      return JSON.parse(fixed); 
    } catch { 
      return null; 
    }
  }
}

/**
 * Build the correct request body for OpenAI API calls
 * Branches by apiFamily to use the correct parameter structure
 */
export function buildOpenAIBody(opts: {
  model: string;
  apiFamily: "responses" | "chat";
  messages: Array<{ role: string; content: any }>;
  maxTokens?: number;
  temperature?: number;
  tools?: any[];
  tool_choice?: any;
}): any {
  const { model, apiFamily, messages, maxTokens, temperature, tools, tool_choice } = opts;
  
  const body: any = { model };

  // Add temperature only if the model supports it
  if (temperature !== undefined && supportsCustomTemperature(model)) {
    body.temperature = temperature;
  }

  if (apiFamily === "responses") {
    // Responses API parameter family
    body.input = messages;
    body.text = { format: { type: "json_object" } };
    if (maxTokens) {
      body.max_output_tokens = maxTokens;
    }
  } else {
    // Chat Completions parameter family
    body.messages = messages;
    body.response_format = { type: "json_object" as const };
    
    if (maxTokens) {
      // Newer models require max_completion_tokens, legacy models use max_tokens
      if (requiresCompletionTokensParam(model)) {
        body.max_completion_tokens = maxTokens;
        console.log(`[openaiHelpers] Using max_completion_tokens for ${model}`);
      } else {
        body.max_tokens = maxTokens;
        console.log(`[openaiHelpers] Using max_tokens for ${model}`);
      }
    }
    
    if (tools) {
      body.tools = tools;
    }
    if (tool_choice) {
      body.tool_choice = tool_choice;
    }
  }

  return body;
}

// Generic JSON call that works with either Responses API or Chat Completions
export async function callOpenAI_JSON(opts: {
  model: string;
  system: string;
  user: any; // object to serialize
  maxTokens?: number;
  temperature?: number;
  useResponsesAPI?: boolean; // default true
  _retryCount?: number; // Internal retry counter
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const {
    model,
    system,
    user,
    maxTokens = 1200,
    temperature,
    useResponsesAPI = process.env.OPENAI_USE_RESPONSES !== "false",
    _retryCount = 0
  } = opts;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(user) }
  ];

  // Ensure at least one message contains "json" for JSON response format
  const safeMessages = ensureJsonWord(messages);

  const apiFamily = useResponsesAPI ? "responses" : "chat";
  const body = buildOpenAIBody({ model, apiFamily, messages: safeMessages, maxTokens, temperature });

  try {
    if (useResponsesAPI) {
      // Responses API (preferred)
      const res = await openai.responses.create(body as any);
      
      // In SDK v4, safest is output_text for JSON and then parse
      const text = (res as any).output_text ?? (res as any).output?.[0]?.content?.[0]?.text;
      
      // Step 1: Add diagnostic logging
      console.log(`[openaiHelpers] Raw response length: ${text?.length || 0} chars`);
      console.log(`[openaiHelpers] First 500 chars: ${text?.substring(0, 500)}`);
      console.log(`[openaiHelpers] Last 200 chars: ${text?.substring(text?.length - 200)}`);
      
      const data = safeJSONParse(text);
      if (!data) {
        console.error(`[openaiHelpers] ❌ Full invalid response:\n${text}`);
        
        // Step 2: Implement real retry logic
        if (_retryCount < 1) {
          console.warn(`[openaiHelpers] Retrying API call (attempt ${_retryCount + 2})...`);
          await new Promise(r => setTimeout(r, 1000)); // 1 sec backoff
          return callOpenAI_JSON({ ...opts, _retryCount: _retryCount + 1 });
        }
        
        throw new Error("OpenAI returned invalid JSON after 2 attempts");
      }
      return data;
    } else {
      // Chat Completions fallback
      const res = await openai.chat.completions.create(body);
      const text = res.choices?.[0]?.message?.content || "{}";
      
      console.log(`[openaiHelpers] Raw response length: ${text?.length || 0} chars`);
      console.log(`[openaiHelpers] First 500 chars: ${text?.substring(0, 500)}`);
      console.log(`[openaiHelpers] Last 200 chars: ${text?.substring(text?.length - 200)}`);
      
      const data = safeJSONParse(text);
      if (!data) {
        console.error(`[openaiHelpers] ❌ Full invalid response:\n${text}`);
        
        if (_retryCount < 1) {
          console.warn(`[openaiHelpers] Retrying API call (attempt ${_retryCount + 2})...`);
          await new Promise(r => setTimeout(r, 1000));
          return callOpenAI_JSON({ ...opts, _retryCount: _retryCount + 1 });
        }
        
        throw new Error("OpenAI returned invalid JSON after 2 attempts");
      }
      return data;
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
      
      // Rebuild body without temperature
      const retryBody = buildOpenAIBody({ 
        model, 
        apiFamily, 
        messages, 
        maxTokens, 
        temperature: undefined 
      });
      
      if (useResponsesAPI) {
        const res = await openai.responses.create(retryBody as any);
        const text = (res as any).output_text ?? (res as any).output?.[0]?.content?.[0]?.text;
        const data = safeJSONParse(text);
        if (!data) throw new Error("OpenAI returned invalid JSON after retry");
        return data;
      } else {
        const res = await openai.chat.completions.create(retryBody);
        const text = res.choices?.[0]?.message?.content || "{}";
        const data = safeJSONParse(text);
        if (!data) throw new Error("OpenAI returned invalid JSON after retry");
        return data;
      }
    }

    // Propagate non-temperature errors
    throw err;
  }
}
