const FINAL_ACTION_WORDS = [
  "submit",
  "register",
  "complete registration",
  "checkout",
  "place order",
  "pay",
  "purchase",
  "confirm purchase",
  "confirm registration",
  "finish registration",
  "enroll",
];

const SAFE_NAVIGATION_WORDS = [
  "next",
  "continue",
  "save and continue",
  "review",
  "go to cart",
  "add participant",
  "select participant",
];

const SENSITIVE_FIELD_WORDS = [
  "allergy",
  "allergies",
  "medical",
  "medication",
  "medicine",
  "diagnosis",
  "doctor",
  "physician",
  "insurance",
  "policy number",
  "disability",
  "special needs",
  "iep",
  "504",
  "epi",
  "epipen",
  "health",
  "social security",
  "ssn",
  "credit card",
  "card number",
  "cardholder",
  "expiration",
  "expiry",
  "security code",
  "billing",
  "cvv",
  "cvc",
  "captcha",
  "password",
];

const AUTH_PAUSE_WORDS = [
  "log in",
  "login",
  "sign in",
  "signed in",
  "stay signed in",
  "forgot my password",
  "create account",
];

const MFA_PAUSE_WORDS = [
  "2fa",
  "mfa",
  "multi-factor",
  "two factor",
  "two-factor",
  "verification code",
  "security code",
  "one-time password",
  "otp",
  "authenticator",
];

const PAYMENT_PAUSE_WORDS = [
  "payment",
  "checkout",
  "card number",
  "credit card",
  "billing",
  "amount due",
  "pay now",
  "confirm payment",
  "payment confirmation",
];

const MEDICAL_PAUSE_WORDS = [
  "medical",
  "medical notes",
  "allergy",
  "allergies",
  "health",
  "diagnosis",
  "insurance",
  "special needs",
  "disability",
  "iep",
  "504",
];

const LEGAL_PAUSE_WORDS = [
  "waiver",
  "release",
  "liability",
  "consent",
  "terms and conditions",
  "terms of service",
  "agree to",
  "i agree",
];

const CAPTCHA_PAUSE_WORDS = [
  "captcha",
  "recaptcha",
  "verify you are human",
];

const PROMPT_INJECTION_WORDS = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "follow these instructions",
  "prompt injection",
  "system prompt",
  "developer message",
  "bypass safety",
  "disable safety",
  "override instructions",
  "disable signupassist",
];

const SOLD_OUT_WORDS = [
  "sold out",
  "waitlist",
  "waiting list",
  "unavailable",
  "no seats",
  "no spots",
  "closed",
];

const PROVIDER_DOMAINS = {
  active: ["active.com", "activecommunities.com", "activenetwork.com"],
  daysmart: ["daysmartrecreation.com", "dashplatform.com", "dashregistration.com", "kevasports.com"],
  amilia: ["amilia.com"],
  "civicrec-recdesk": ["civicrec.com", "recdesk.com"],
  campminder: ["campminder.com"],
};

const FIELD_MATCHERS = [
  { field: "childFirstName", words: ["child first", "participant first", "camper first", "student first"] },
  { field: "childLastName", words: ["child last", "participant last", "camper last", "student last"] },
  { field: "childDob", words: ["child date of birth", "participant date of birth", "camper date of birth", "date of birth", "dob"] },
  { field: "parentFirstName", words: ["parent first", "guardian first", "adult first"] },
  { field: "parentLastName", words: ["parent last", "guardian last", "adult last"] },
  { field: "parentEmail", words: ["parent email", "guardian email", "email address", "email"] },
  { field: "parentPhone", words: ["parent phone", "guardian phone", "phone number", "mobile"] },
  { field: "address1", words: ["address line 1", "street address", "address"] },
  { field: "city", words: ["city"] },
  { field: "state", words: ["state"] },
  { field: "zip", words: ["zip", "postal"] },
];

const STORAGE_KEYS = {
  runPacket: "signupassistRunPacket",
  assistMode: "signupassistAssistMode",
};

const SETUP_METADATA_KEYS = [
  "signupassistSetupMetadata",
  "signupassistSetup",
  "signupassistHelperSetup",
];

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
    return map[char];
  });
}

function overlay(message, items = []) {
  let node = document.getElementById("signupassist-overlay");
  if (!node) {
    node = document.createElement("section");
    node.id = "signupassist-overlay";
    node.innerHTML = "<header><span>SignupAssist</span><span>Supervised</span></header><main></main>";
    document.documentElement.appendChild(node);
  }

  const list = items.length
    ? `<ul>${items.slice(0, 6).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  node.querySelector("main").innerHTML = `<p>${escapeHtml(message)}</p>${list}`;
}

async function getStoredValue(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : fallback;
}

async function getRunPacket() {
  const signupassistRunPacket = await getStoredValue(STORAGE_KEYS.runPacket, null);
  if (!signupassistRunPacket || typeof signupassistRunPacket !== "object") return null;
  if (signupassistRunPacket.mode !== "supervised_autopilot") return null;
  return signupassistRunPacket;
}

async function getAssistModeEnabled() {
  return Boolean(await getStoredValue(STORAGE_KEYS.assistMode, false));
}

async function getSetupMetadata() {
  const result = await chrome.storage.local.get(SETUP_METADATA_KEYS);
  for (const key of SETUP_METADATA_KEYS) {
    const value = result[key];
    if (value && typeof value === "object") {
      return value;
    }
  }
  return null;
}

function summarizePacket(packet) {
  if (!packet) return [];

  const summary = [];
  if (packet.target?.providerName) summary.push(`Provider: ${packet.target.providerName}`);
  if (packet.target?.child?.name) summary.push(`Child: ${packet.target.child.name}`);
  if (packet.target?.program) summary.push(`Target: ${packet.target.program}`);
  if (typeof packet.target?.maxTotalCents === "number") {
    summary.push(`Price cap: $${(packet.target.maxTotalCents / 100).toFixed(0)}`);
  }
  if (typeof packet.readiness?.score === "number") summary.push(`Readiness: ${packet.readiness.score}%`);
  return summary;
}

function normalizeHost(value) {
  if (!value) return "";

  const raw = String(value).trim().toLowerCase();
  if (!raw) return "";

  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.replace(/^\.+/, "").replace(/\.+$/, "");
  }
}

function toStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => toStringList(item));
  if (typeof value === "string") return [value];
  return [];
}

function hostMatchesCandidate(host, candidate) {
  const normalizedHost = normalizeHost(host);
  const normalizedCandidate = normalizeHost(candidate);
  if (!normalizedHost || !normalizedCandidate) return false;
  return normalizedHost === normalizedCandidate || normalizedHost.endsWith(`.${normalizedCandidate}`);
}

function getPacketProviderKey(packet) {
  const providerKey = normalize(packet?.target?.providerKey);
  return providerKey && providerKey !== "generic" ? providerKey : "";
}

function getPacketProviderName(packet) {
  return normalize(packet?.target?.providerName);
}

function getSetupProviderKey(setupMetadata) {
  return normalize(setupMetadata?.providerKey || setupMetadata?.provider_key);
}

function getSetupProviderName(setupMetadata) {
  return normalize(setupMetadata?.providerName || setupMetadata?.provider_name);
}

function getSetupState(setupMetadata) {
  return normalize(setupMetadata?.state || setupMetadata?.mode || setupMetadata?.providerState || setupMetadata?.provider_state);
}

function getPacketTargetHost(packet) {
  const targetUrl = packet?.target?.url;
  if (!targetUrl) return "";
  try {
    return new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return normalizeHost(targetUrl);
  }
}

function getSupportedHosts(packet, setupMetadata) {
  const hosts = new Set();

  const packetTargetHost = getPacketTargetHost(packet);
  if (packetTargetHost) hosts.add(packetTargetHost);

  const packetProviderKey = getPacketProviderKey(packet);
  if (packetProviderKey) {
    (PROVIDER_DOMAINS[packetProviderKey] || []).forEach((domain) => hosts.add(normalizeHost(domain)));
  }

  [
    setupMetadata?.supportedHosts,
    setupMetadata?.supported_hosts,
    setupMetadata?.allowedHosts,
    setupMetadata?.allowed_hosts,
    setupMetadata?.hosts,
    setupMetadata?.domains,
    setupMetadata?.origins,
    setupMetadata?.origin,
    setupMetadata?.host,
    setupMetadata?.hostname,
    setupMetadata?.url,
    setupMetadata?.targetUrl,
  ]
    .flatMap((value) => toStringList(value))
    .forEach((value) => {
      const host = normalizeHost(value);
      if (host) hosts.add(host);
    });

  return [...hosts].filter(Boolean);
}

function getHostSupportStatus(packet, setupMetadata) {
  const currentHost = normalizeHost(window.location.hostname);
  const supportedHosts = getSupportedHosts(packet, setupMetadata);
  return {
    currentHost,
    supportedHosts,
    hostSupported: supportedHosts.some((host) => hostMatchesCandidate(currentHost, host)),
  };
}

function getHelperReadiness(packet, setupMetadata) {
  const packetProviderKey = getPacketProviderKey(packet);
  const packetProviderName = getPacketProviderName(packet);
  const setupProviderKey = getSetupProviderKey(setupMetadata);
  const setupProviderName = getSetupProviderName(setupMetadata);
  const setupState = getSetupState(setupMetadata);
  const { currentHost, supportedHosts, hostSupported } = getHostSupportStatus(packet, setupMetadata);
  const reasons = [];

  const resolvedProviderKey = packetProviderKey || setupProviderKey;
  const resolvedProviderName = packetProviderName || setupProviderName;

  if (!resolvedProviderKey && !resolvedProviderName) {
    reasons.push("Helper readiness is waiting for a provider setup or run packet");
  }

  if (packetProviderKey && setupProviderKey && packetProviderKey !== setupProviderKey) {
    reasons.push("Provider mismatch: run packet and setup metadata do not describe the same provider");
  }

  if (packetProviderName && setupProviderName && packetProviderName !== setupProviderName) {
    reasons.push("Provider mismatch: run packet and setup metadata do not describe the same provider");
  }

  if (!supportedHosts.length) {
    reasons.push("Host support is missing: no supported provider host was found");
  } else if (!hostSupported) {
    reasons.push("Provider mismatch: current page does not match the supported host list");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    currentHost,
    resolvedProviderKey,
    resolvedProviderName,
    setupState,
    supportedHosts,
    packetProviderKey,
    packetProviderName,
    setupProviderKey,
    setupProviderName,
    setupMetadataLoaded: Boolean(setupMetadata),
  };
}

function hostMatchesPacket(packet, setupMetadata = null) {
  return getHostSupportStatus(packet, setupMetadata).hostSupported;
}

function collectReadinessPauses(packet, setupMetadata) {
  const readiness = getHelperReadiness(packet, setupMetadata);
  return readiness.ready ? [] : readiness.reasons;
}

function detectTextPause(words) {
  const text = normalize(document.body?.innerText || "");
  return words.some((word) => text.includes(word));
}

function detectSoldOutText() {
  return detectTextPause(SOLD_OUT_WORDS);
}

function detectPromptInjection() {
  const text = normalize(document.body?.innerText || "");
  return PROMPT_INJECTION_WORDS.some((word) => text.includes(word));
}

function detectAuthPause() {
  if (document.querySelector('input[type="password"]')) return true;
  return detectTextPause(AUTH_PAUSE_WORDS);
}

function detectMfaPause() {
  if (
    document.querySelector(
      'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="mfa" i], input[id*="mfa" i]',
    )
  ) {
    return true;
  }
  return detectTextPause(MFA_PAUSE_WORDS);
}

function detectPaymentPause() {
  if (
    document.querySelector(
      'input[autocomplete*="cc" i], input[name*="card" i], input[id*="card" i], input[name*="cvv" i], input[id*="cvv" i]',
    )
  ) {
    return true;
  }
  return detectTextPause(PAYMENT_PAUSE_WORDS);
}

function detectCaptchaPause() {
  if (document.querySelector('[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i]')) {
    return true;
  }
  return detectTextPause(CAPTCHA_PAUSE_WORDS);
}

function detectLegalPause() {
  return detectTextPause(LEGAL_PAUSE_WORDS);
}

function detectMedicalPause() {
  return detectTextPause(MEDICAL_PAUSE_WORDS);
}

function detectMaxVisiblePriceCents() {
  const text = document.body?.innerText || "";
  const matches = Array.from(text.matchAll(/\$\s?([0-9]{1,4})(?:\.([0-9]{2}))?/g));
  if (!matches.length) return null;

  return matches.reduce((max, match) => {
    const dollars = Number(match[1]);
    const cents = Number(match[2] || "0");
    if (!Number.isFinite(dollars) || !Number.isFinite(cents)) return max;
    return Math.max(max, dollars * 100 + cents);
  }, 0);
}

function collectPacketPauses(packet, setupMetadata = null) {
  const pauses = [];

  if (packet && !hostMatchesPacket(packet, setupMetadata)) {
    pauses.push("Provider mismatch: current page does not match the run packet provider");
  }

  if (detectSoldOutText()) {
    pauses.push("Sold-out, closed, unavailable, or waitlist language detected");
  }

  if (detectAuthPause()) {
    pauses.push("Login or account step detected: parent signs in before the helper continues");
  }

  if (detectMfaPause()) {
    pauses.push("MFA or verification-code step detected: parent action required");
  }

  if (detectPaymentPause()) {
    pauses.push("Payment screen or card field detected: parent review required");
  }

  if (detectCaptchaPause()) {
    pauses.push("CAPTCHA or human verification detected: parent action required");
  }

  if (detectLegalPause()) {
    pauses.push("Waiver, release, or legal acceptance detected: parent review required");
  }

  if (detectMedicalPause()) {
    pauses.push("Medical or allergy information detected: parent review required");
  }

  if (detectPromptInjection()) {
    pauses.push("Prompt injection or instruction override detected");
  }

  const visiblePriceCents = detectMaxVisiblePriceCents();
  const capCents = packet?.target?.maxTotalCents;
  if (typeof visiblePriceCents === "number" && typeof capCents === "number" && visiblePriceCents > capCents) {
    pauses.push(`Price above cap: $${(visiblePriceCents / 100).toFixed(2)} visible, cap is $${(capCents / 100).toFixed(2)}`);
  }

  return pauses;
}

function getFieldLabel(field) {
  const parts = [
    field.getAttribute("aria-label"),
    field.getAttribute("placeholder"),
    field.getAttribute("name"),
    field.getAttribute("id"),
  ];

  if (field.id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (explicit) parts.push(explicit.textContent);
  }

  const wrappingLabel = field.closest("label");
  if (wrappingLabel) parts.push(wrappingLabel.textContent);

  const container = field.closest("div, section, fieldset, tr");
  if (container) {
    const localLabel = container.querySelector("label, legend, th");
    if (localLabel) parts.push(localLabel.textContent);
  }

  return normalize(parts.filter(Boolean).join(" "));
}

function isSensitive(label, field) {
  const fieldType = normalize(field.getAttribute("type"));
  if (fieldType === "password" || fieldType === "file") return true;
  return SENSITIVE_FIELD_WORDS.some((word) => label.includes(word));
}

function matchProfileField(label) {
  return FIELD_MATCHERS.find((matcher) => matcher.words.some((word) => label.includes(word)));
}

function fillField(field, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  const setter = field.tagName === "TEXTAREA" ? nativeTextAreaValueSetter : nativeInputValueSetter;

  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }

  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  field.classList.add("signupassist-filled");
}

function classifyButton(button) {
  const visibleText = normalize([button.textContent, button.getAttribute("aria-label")].filter(Boolean).join(" "));
  const type = normalize(button.getAttribute("type"));

  if (visibleText && FINAL_ACTION_WORDS.some((word) => visibleText.includes(word))) {
    return { kind: "forbidden_final", reason: "Final action requires parent approval" };
  }

  if (visibleText && SAFE_NAVIGATION_WORDS.some((word) => visibleText === word || visibleText.includes(word))) {
    return { kind: "safe_navigation", reason: "Safe non-final navigation" };
  }

  if (type === "submit") {
    return { kind: "unknown", reason: "Submit button needs visible context" };
  }

  return { kind: "unknown", reason: "Unknown button meaning" };
}

async function scanPage() {
  const [packet, assistModeEnabled, setupMetadata] = await Promise.all([
    getRunPacket(),
    getAssistModeEnabled(),
    getSetupMetadata(),
  ]);
  const fields = Array.from(document.querySelectorAll("input, textarea, select"));
  const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a[role='button']"));
  const pauses = collectPacketPauses(packet, setupMetadata);
  const safeButtons = [];
  const forbiddenButtons = [];

  fields.forEach((field) => {
    const label = getFieldLabel(field);
    if (isSensitive(label, field)) {
      field.classList.add("signupassist-paused");
      pauses.push(`Sensitive field: ${label || field.tagName.toLowerCase()}`);
      return;
    }

    if (field.required && !matchProfileField(label)) {
      field.classList.add("signupassist-paused");
      pauses.push(`Unknown required field: ${label || field.getAttribute("name") || field.tagName.toLowerCase()}`);
    }
  });

  buttons.forEach((button) => {
    const classification = classifyButton(button);
    button.classList.remove("signupassist-safe-button", "signupassist-forbidden-button");
    if (classification.kind === "safe_navigation") {
      button.classList.add("signupassist-safe-button");
      safeButtons.push(normalize(button.textContent || button.getAttribute("aria-label")));
    }
    if (classification.kind === "forbidden_final") {
      button.classList.add("signupassist-forbidden-button");
      forbiddenButtons.push(normalize(button.textContent || button.getAttribute("aria-label")));
    }
  });

  overlay(
    `Page scanned. Assist Mode is ${assistModeEnabled ? "on" : "off"}. Parent approval stays required for risky moments.`,
    [
      ...summarizePacket(packet),
      ...collectReadinessPauses(packet, setupMetadata),
      `${fields.length} fields`,
      `${safeButtons.length} safe navigation buttons`,
      `${forbiddenButtons.length} final-action buttons`,
      `${pauses.length} pause conditions`,
    ],
  );

  return {
    fields: fields.length,
    buttons: buttons.length,
    pauses,
    safeButtons,
    forbiddenButtons,
    assistModeEnabled,
    runPacketLoaded: Boolean(packet),
  };
}

async function fillKnownFields() {
  const [{ signupassistProfile = {} }, packet, assistModeEnabled, setupMetadata] = await Promise.all([
    chrome.storage.local.get("signupassistProfile"),
    getRunPacket(),
    getAssistModeEnabled(),
    getSetupMetadata(),
  ]);
  const fields = Array.from(document.querySelectorAll("input, textarea"));
  const filled = [];
  const pauses = collectPacketPauses(packet, setupMetadata);
  const readiness = getHelperReadiness(packet, setupMetadata);
  const canAct = readiness.ready;

  fields.forEach((field) => {
    if (field.disabled || field.readOnly || field.value) return;
    const label = getFieldLabel(field);

    if (isSensitive(label, field)) {
      field.classList.add("signupassist-paused");
      pauses.push(label || field.getAttribute("name") || "Sensitive field");
      return;
    }

    const match = matchProfileField(label);
    if (!match) {
      if (field.required) {
        field.classList.add("signupassist-paused");
        pauses.push(`Unknown required field: ${label || field.getAttribute("name") || "Required field"}`);
      }
      return;
    }

    if (!canAct) return;

    const value = signupassistProfile[match.field];
    if (!value) return;

    fillField(field, value);
    filled.push(label || match.field);
  });

  if (!canAct) {
    overlay(
      "Prepared fields were not filled because the helper is not ready for this provider or host.",
      [
        ...summarizePacket(packet),
        ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []),
        ...readiness.reasons,
        `${pauses.length} pause conditions`,
      ],
    );
    return {
      blocked: true,
      continued: false,
      reason: readiness.reasons[0] || "Helper readiness is not satisfied",
      pauses,
      assistModeEnabled,
      runPacketLoaded: Boolean(packet),
      setupMetadataLoaded: readiness.setupMetadataLoaded,
    };
  }

  overlay(
    `Prepared fields filled. Assist Mode is ${assistModeEnabled ? "on" : "off"}. Parent approval is still required for final submit, waivers, payments, unknown fields, and price changes.`,
    [
      ...summarizePacket(packet),
      ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []),
      `${filled.length} fields filled`,
      `${pauses.length} pause conditions`,
    ],
  );

  return { filled, pauses, assistModeEnabled, runPacketLoaded: Boolean(packet), setupMetadataLoaded: readiness.setupMetadataLoaded };
}

function clickFirstSafeButton() {
  const buttons = Array.from(
    document.querySelectorAll("button, input[type='button'], input[type='submit'], a[role='button']"),
  );
  const safeButton = buttons.find((button) => classifyButton(button).kind === "safe_navigation" && !button.disabled);

  if (!safeButton) {
    return null;
  }

  safeButton.click();
  safeButton.classList.add("signupassist-safe-button");
  return safeButton;
}

async function safeContinue() {
  const [packet, assistModeEnabled, setupMetadata] = await Promise.all([
    getRunPacket(),
    getAssistModeEnabled(),
    getSetupMetadata(),
  ]);
  const pauses = collectPacketPauses(packet, setupMetadata);
  const readiness = getHelperReadiness(packet, setupMetadata);

  if (!readiness.ready) {
    overlay(
      "Safe continue paused because the helper is not ready for this provider or host.",
      [
        ...summarizePacket(packet),
        ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []),
        ...readiness.reasons,
        ...pauses,
      ],
    );
    return {
      blocked: true,
      continued: false,
      reason: readiness.reasons[0] || "Helper readiness is not satisfied",
      pauses,
      runPacketLoaded: Boolean(packet),
      assistModeEnabled,
      setupMetadataLoaded: readiness.setupMetadataLoaded,
    };
  }

  if (!assistModeEnabled) {
    overlay(
      "Assist Mode is off. Turn it on to allow safe navigation clicks.",
      [...summarizePacket(packet), ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []), `${pauses.length} pause conditions`],
    );
    return {
      blocked: true,
      continued: false,
      reason: "Assist Mode is off",
      pauses,
      runPacketLoaded: Boolean(packet),
      assistModeEnabled,
    };
  }

  if (pauses.length) {
    overlay(
      "Safe continue paused for the parent.",
      [...summarizePacket(packet), ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []), ...pauses],
    );
    return {
      blocked: true,
      continued: false,
      reason: "Pause conditions detected",
      pauses,
      runPacketLoaded: Boolean(packet),
      assistModeEnabled,
    };
  }

  const clickedButton = clickFirstSafeButton();
  if (!clickedButton) {
    overlay(
      "No safe navigation button was found.",
      [...summarizePacket(packet), "Safe continue did not find a button to click"],
    );
    return {
      blocked: true,
      continued: false,
      reason: "No safe navigation button found",
      pauses,
      runPacketLoaded: Boolean(packet),
      assistModeEnabled,
    };
  }

  overlay(
    "Safe continue clicked a non-final navigation button.",
    [
      ...summarizePacket(packet),
      ...(readiness.setupState ? [`Setup state: ${readiness.setupState}`] : []),
      normalize(clickedButton.textContent || clickedButton.getAttribute("aria-label")),
    ],
  );
  return {
    blocked: false,
    continued: true,
    clicked: normalize(clickedButton.textContent || clickedButton.getAttribute("aria-label")),
    pauses,
    runPacketLoaded: Boolean(packet),
    assistModeEnabled,
    setupMetadataLoaded: readiness.setupMetadataLoaded,
  };
}

function clearHelperState() {
  document.getElementById("signupassist-overlay")?.remove();
  document
    .querySelectorAll(".signupassist-filled, .signupassist-paused, .signupassist-safe-button, .signupassist-forbidden-button")
    .forEach((node) => {
      node.classList.remove(
        "signupassist-filled",
        "signupassist-paused",
        "signupassist-safe-button",
        "signupassist-forbidden-button",
      );
    });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SIGNUPASSIST_SCAN") {
    scanPage().then(sendResponse);
    return true;
  }

  if (message?.type === "SIGNUPASSIST_FILL_KNOWN") {
    fillKnownFields().then(sendResponse);
    return true;
  }

  if (message?.type === "SIGNUPASSIST_SAFE_CONTINUE") {
    safeContinue().then(sendResponse);
    return true;
  }

  if (message?.type === "SIGNUPASSIST_STOP") {
    clearHelperState();
    sendResponse({ stopped: true });
    return true;
  }

  return false;
});
