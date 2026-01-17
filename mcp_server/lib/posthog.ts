/**
 * Minimal PostHog capture helper (server-side)
 *
 * Design goals:
 * - No hard dependency: if POSTHOG_API_KEY is missing, this is a no-op.
 * - Never block core flows: time-box network calls and swallow errors.
 */

type PostHogProperties = Record<string, any>;

function getPostHogConfig() {
  const apiKey = process.env.POSTHOG_API_KEY;
  const host = (process.env.POSTHOG_HOST || "https://app.posthog.com").replace(/\/$/, "");
  const timeoutMsRaw = Number(process.env.POSTHOG_TIMEOUT_MS || 1200);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 1200;
  return { apiKey, host, timeoutMs };
}

export async function capturePostHogEvent(
  event: string,
  distinctId: string,
  properties: PostHogProperties = {},
): Promise<void> {
  const { apiKey, host, timeoutMs } = getPostHogConfig();
  if (!apiKey) return;

  const body = {
    api_key: apiKey,
    event,
    properties: {
      distinct_id: distinctId,
      ...properties,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // swallow (telemetry must never take prod down)
  } finally {
    clearTimeout(timer);
  }
}


