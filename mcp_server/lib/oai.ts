import OpenAI from "openai";
import { supportsCustomTemperature } from "./openaiHelpers.js";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** 
 * Production models - always use the best for accuracy.
 * Env vars allow override for testing, but default to gpt-4o.
 */
export const MODELS = {
  vision:    process.env.OPENAI_MODEL_PROGRAM_VISION    || "gpt-4o",
  extractor: process.env.OPENAI_MODEL_PROGRAM_EXTRACTOR || "gpt-4o",
  validator: process.env.OPENAI_MODEL_PROGRAM_VALIDATOR || "gpt-4o",
  grouper:   process.env.OPENAI_MODEL_PROGRAM_GROUPER   || "gpt-4o",
};

/** 
 * Add the model field and strip temperature if the model doesn't allow it.
 * Uses the centralized supportsCustomTemperature helper.
 */
export function withModel<T extends Record<string, any>>(model: string, body: T): T & { model: string } {
  const b: any = { ...body };
  if (b.temperature !== undefined && !supportsCustomTemperature(model)) {
    delete b.temperature; // avoid 400 "Unsupported value: 'temperature'..."
  }
  return { ...b, model };
}
