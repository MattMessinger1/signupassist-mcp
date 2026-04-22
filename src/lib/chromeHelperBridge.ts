import type { NavigateFunction } from "react-router-dom";
import type { AutopilotRunPacket } from "@/lib/autopilot/runPacket";

export const HELPER_BRIDGE_MESSAGES = {
  ping: "SIGNUPASSIST_HELPER_PING",
  detected: "SIGNUPASSIST_HELPER_DETECTED",
  storePacket: "SIGNUPASSIST_HELPER_STORE_PACKET",
  storeResult: "SIGNUPASSIST_HELPER_STORE_RESULT",
} as const;

const WEB_SOURCE = "signupassist-web";
const HELPER_SOURCE = "signupassist-helper";
const DEFAULT_TIMEOUT_MS = 900;

type HelperResult = {
  ok: boolean;
  error?: string;
};

function waitForHelperMessage<T extends { type: string }>(
  expectedType: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== HELPER_SOURCE || data.type !== expectedType) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data as T);
    }

    window.addEventListener("message", onMessage);
  });
}

export async function detectChromeHelper(timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof window === "undefined") return false;
  const responsePromise = waitForHelperMessage(HELPER_BRIDGE_MESSAGES.detected, timeoutMs);
  window.postMessage(
    {
      source: WEB_SOURCE,
      type: HELPER_BRIDGE_MESSAGES.ping,
    },
    window.location.origin,
  );
  return Boolean(await responsePromise);
}

export async function sendPacketToChromeHelper(
  packet: AutopilotRunPacket,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  if (typeof window === "undefined") {
    return { ok: false, error: "browser_unavailable" };
  }

  const responsePromise = waitForHelperMessage<HelperResult & { type: string }>(
    HELPER_BRIDGE_MESSAGES.storeResult,
    timeoutMs,
  );
  window.postMessage(
    {
      source: WEB_SOURCE,
      type: HELPER_BRIDGE_MESSAGES.storePacket,
      packet,
    },
    window.location.origin,
  );

  return (await responsePromise) || { ok: false, error: "helper_bridge_timeout" };
}

export async function launchHelperOrRedirect({
  packet,
  providerUrl,
  returnTo,
  navigate,
}: {
  packet: AutopilotRunPacket;
  providerUrl: string | null;
  returnTo: string;
  navigate: NavigateFunction;
}) {
  const helperReady = await detectChromeHelper();

  if (!helperReady) {
    navigate(`/chrome-helper/setup?returnTo=${encodeURIComponent(returnTo)}`);
    return { ok: false, reason: "helper_not_installed" as const };
  }

  const stored = await sendPacketToChromeHelper(packet);
  if (!stored.ok) {
    return { ok: false, reason: "bridge_failed" as const };
  }

  if (providerUrl) {
    window.open(providerUrl, "_blank", "noopener,noreferrer");
  }

  return { ok: true, reason: "launched" as const };
}
