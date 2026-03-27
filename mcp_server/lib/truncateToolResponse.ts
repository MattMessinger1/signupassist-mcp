/**
 * Optional response-size cap for MCP tool outputs.
 *
 * Gated by the MAX_TOOL_RESPONSE_CHARS env var.
 * When the env var is **unset or empty**, this is a no-op — existing behavior is preserved.
 * Set it (e.g. `MAX_TOOL_RESPONSE_CHARS=90000`) to enforce a hard character limit,
 * which is useful for MCP clients like Claude that cap tool results at ~25k tokens.
 */

const TRUNCATION_SUFFIX = '\n\n[Response truncated — exceeded maximum allowed size]';

function getMaxChars(): number | null {
  const raw = process.env.MAX_TOOL_RESPONSE_CHARS;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Truncate a text string to the configured character limit.
 * Returns the original string unchanged when the limit is unset or not exceeded.
 */
export function truncateText(text: string): string {
  const max = getMaxChars();
  if (!max || text.length <= max) return text;
  return text.slice(0, max - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

/**
 * Truncate an MCP tool result's `content` array entries in-place.
 * Only affects `type: "text"` content blocks.
 * Returns the (possibly mutated) result object.
 */
export function truncateToolResponse<T extends Record<string, any>>(result: T): T {
  const max = getMaxChars();
  if (!max) return result;

  const content = (result as any)?.content;
  if (!Array.isArray(content)) return result;

  let totalChars = 0;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      totalChars += block.text.length;
    }
  }

  if (totalChars <= max) return result;

  let remaining = max;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      if (block.text.length <= remaining) {
        remaining -= block.text.length;
      } else {
        block.text = block.text.slice(0, Math.max(0, remaining - TRUNCATION_SUFFIX.length)) + TRUNCATION_SUFFIX;
        remaining = 0;
      }
    }
  }

  return result;
}
