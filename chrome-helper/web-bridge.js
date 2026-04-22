(function signupAssistWebBridge() {
  const WEB_SOURCE = "signupassist-web";
  const HELPER_SOURCE = "signupassist-helper";
  const STORAGE_KEYS = {
    runPacket: "signupassistRunPacket",
    helperSetup: "signupassistHelperSetup",
    assistMode: "signupassistAssistMode",
  };

  const MESSAGE_TYPES = {
    ping: "SIGNUPASSIST_HELPER_PING",
    detected: "SIGNUPASSIST_HELPER_DETECTED",
    storePacket: "SIGNUPASSIST_HELPER_STORE_PACKET",
    storeResult: "SIGNUPASSIST_HELPER_STORE_RESULT",
  };

  const DENIED_KEY_PATTERN = /token|secret|credential|password|card|cvv|medical|allergy|audit|helper.?code/i;
  const ALLOWED_ORIGINS = new Set([
    "https://signupassist.shipworx.ai",
    "http://localhost",
    "https://localhost",
    "http://127.0.0.1",
    "https://127.0.0.1",
  ]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function sanitize(value) {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item)).filter((item) => item !== undefined);
    }

    if (!isPlainObject(value)) return value;

    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      if (DENIED_KEY_PATTERN.test(key)) return;
      const sanitized = sanitize(item);
      if (sanitized !== undefined) next[key] = sanitized;
    });
    return next;
  }

  function post(type, payload) {
    window.postMessage(
      {
        source: HELPER_SOURCE,
        type,
        ...payload,
      },
      window.location.origin,
    );
  }

  async function storePacket(packet) {
    if (!packet || packet.version !== 1 || packet.mode !== "supervised_autopilot") {
      post(MESSAGE_TYPES.storeResult, { ok: false, error: "invalid_packet" });
      return;
    }

    const sanitizedPacket = sanitize(packet);
    await chrome.storage.local.set({
      [STORAGE_KEYS.runPacket]: sanitizedPacket,
      [STORAGE_KEYS.assistMode]: false,
      [STORAGE_KEYS.helperSetup]: {
        state: "ready_same_provider",
        providerName: sanitizedPacket.target?.providerName || "Provider",
        providerKey: sanitizedPacket.target?.providerKey || null,
        program: sanitizedPacket.target?.program || null,
        loadedAt: new Date().toISOString(),
      },
    });
    post(MESSAGE_TYPES.storeResult, { ok: true });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!ALLOWED_ORIGINS.has(window.location.origin)) return;
    const message = event.data || {};
    if (message.source !== WEB_SOURCE) return;

    if (message.type === MESSAGE_TYPES.ping) {
      post(MESSAGE_TYPES.detected, { ok: true, version: chrome.runtime.getManifest().version });
      return;
    }

    if (message.type === MESSAGE_TYPES.storePacket) {
      void storePacket(message.packet);
    }
  });
})();
