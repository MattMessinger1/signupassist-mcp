import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** Single place to choose models, with sane fallbacks. */
export const MODELS = {
  vision:    process.env.OPENAI_MODEL_PROGRAM_VISION    || "gpt-4o",
  extractor: process.env.OPENAI_MODEL_PROGRAM_EXTRACTOR || "gpt-4o-mini",
  validator: process.env.OPENAI_MODEL_PROGRAM_VALIDATOR || "gpt-4o-mini",
  grouper:   process.env.OPENAI_MODEL_PROGRAM_GROUPER   || process.env.OPENAI_MODEL_PROGRAM_VALIDATOR || "gpt-4o-mini",
};

/** Some models only accept the default temp (1). */
const FIXED_TEMP = /(^(gpt-5|o3|o4|gpt-o3)\b)/i;

/** Add the model field and strip temperature if the model doesn't allow it. */
export function withModel<T extends Record<string, any>>(model: string, body: T): T & { model: string } {
  const b: any = { ...body };
  if (b.temperature !== undefined && FIXED_TEMP.test(model)) {
    delete b.temperature; // avoid 400 "Unsupported value: 'temperature'..."
  }
  return { ...b, model };
}
