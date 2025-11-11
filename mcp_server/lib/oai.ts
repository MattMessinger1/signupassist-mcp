import OpenAI from "openai";
import { supportsCustomTemperature } from "./openaiHelpers.js";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** Single place to choose models, with sane fallbacks. */
export const MODELS = {
  vision:    process.env.OPENAI_MODEL_PROGRAM_VISION    || "gpt-4o",
  extractor: process.env.OPENAI_MODEL_PROGRAM_EXTRACTOR || "gpt-4o-mini",
  validator: process.env.OPENAI_MODEL_PROGRAM_VALIDATOR || "gpt-4o-mini",
  grouper:   process.env.OPENAI_MODEL_PROGRAM_GROUPER   || process.env.OPENAI_MODEL_PROGRAM_VALIDATOR || "gpt-4o-mini",
};

/** Accuracy-optimized models for cache refresh (overnight jobs) */
export const ACCURACY_MODELS = {
  vision:    process.env.CACHE_REFRESH_VISION_MODEL    || "gpt-4o",
  extractor: process.env.CACHE_REFRESH_EXTRACTOR_MODEL || "gpt-4o",
  validator: process.env.CACHE_REFRESH_VALIDATOR_MODEL || "gpt-4o",
  grouper:   "gpt-4o",
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
