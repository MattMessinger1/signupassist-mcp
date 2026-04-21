const profileFields = [
  "childFirstName",
  "childLastName",
  "childDob",
  "parentEmail",
  "parentPhone",
];

const STORAGE_KEYS = {
  runPacket: "signupassistRunPacket",
  assistMode: "signupassistAssistMode",
  helperCode: "signupassistHelperCode",
  profile: "signupassistProfile",
};

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

function setSummary(message) {
  document.getElementById("packetSummary").textContent = message;
}

function setHelperCodeSummary(message) {
  document.getElementById("helperCodeSummary").textContent = message;
}

function setAssistModeSummary(enabled) {
  document.getElementById("assistModeSummary").textContent = enabled
    ? "Assist Mode on"
    : "Assist Mode off";
  document.getElementById("assistMode").checked = enabled;
  document.getElementById("safeContinue").disabled = !enabled;
}

function summarizePacket(packet) {
  if (!packet?.target) return "No run packet loaded.";
  const parts = [
    packet.target.providerName,
    packet.target.child?.name,
    packet.target.program,
    typeof packet.target.maxTotalCents === "number"
      ? `$${(packet.target.maxTotalCents / 100).toFixed(0)} cap`
      : null,
    typeof packet.readiness?.score === "number" ? `${packet.readiness.score}% ready` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Run packet loaded.";
}

function helperCodeSummary(helperCode, packet) {
  if (!helperCode) return "No helper code loaded.";
  if (!packet?.target?.providerName) return `Helper code saved: ${helperCode}`;
  return `Helper code ${helperCode} -> ${packet.target.providerName}`;
}

function setPacketDetails(packet) {
  const provider = packet?.target?.providerName || "No packet loaded";
  const child = packet?.target?.child?.name || "Choose in SignupAssist";
  const cap = typeof packet?.target?.maxTotalCents === "number"
    ? `$${(packet.target.maxTotalCents / 100).toFixed(2)}`
    : "Not set";

  document.getElementById("providerDetected").textContent = provider;
  document.getElementById("childSelected").textContent = child;
  document.getElementById("priceCap").textContent = cap;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No active tab");
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function readStoredState() {
  const state = await chrome.storage.local.get([
    STORAGE_KEYS.profile,
    STORAGE_KEYS.runPacket,
    STORAGE_KEYS.assistMode,
    STORAGE_KEYS.helperCode,
  ]);
  return {
    signupassistProfile: state[STORAGE_KEYS.profile] || {},
    signupassistRunPacket: state[STORAGE_KEYS.runPacket] || null,
    signupassistAssistMode: Boolean(state[STORAGE_KEYS.assistMode]),
    signupassistHelperCode: state[STORAGE_KEYS.helperCode] || "",
  };
}

async function loadProfile() {
  const {
    signupassistProfile,
    signupassistRunPacket,
    signupassistAssistMode,
    signupassistHelperCode,
  } = await readStoredState();

  profileFields.forEach((field) => {
    document.getElementById(field).value = signupassistProfile[field] || "";
  });

  if (signupassistRunPacket) {
    document.getElementById("runPacket").value = JSON.stringify(signupassistRunPacket, null, 2);
  }

  document.getElementById("helperCode").value = signupassistHelperCode;
  setSummary(summarizePacket(signupassistRunPacket));
  setHelperCodeSummary(helperCodeSummary(signupassistHelperCode, signupassistRunPacket));
  setPacketDetails(signupassistRunPacket);
  setAssistModeSummary(signupassistAssistMode);
}

async function saveProfile() {
  const signupassistProfile = {};
  profileFields.forEach((field) => {
    signupassistProfile[field] = document.getElementById(field).value.trim();
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.profile]: signupassistProfile });
  setStatus("Profile saved.");
}

async function saveRunPacket() {
  const rawPacket = document.getElementById("runPacket").value.trim();
  if (!rawPacket) {
    await chrome.storage.local.remove(STORAGE_KEYS.runPacket);
    setSummary("No run packet loaded.");
    setHelperCodeSummary(helperCodeSummary(document.getElementById("helperCode").value.trim(), null));
    setPacketDetails(null);
    setStatus("Run packet cleared.");
    return;
  }

  let packet;
  try {
    packet = JSON.parse(rawPacket);
  } catch {
    setStatus("Run packet must be valid JSON.");
    return;
  }

  if (packet?.mode !== "supervised_autopilot" || packet?.version !== 1) {
    setStatus("This does not look like a SignupAssist supervised run packet.");
    return;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.runPacket]: packet });
  setSummary(summarizePacket(packet));
  setHelperCodeSummary(helperCodeSummary(document.getElementById("helperCode").value.trim(), packet));
  setPacketDetails(packet);
  setStatus("Run packet saved.");
}

async function saveAssistMode(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.assistMode]: Boolean(enabled) });
  setAssistModeSummary(Boolean(enabled));
  setStatus(enabled ? "Assist Mode enabled." : "Assist Mode paused.");
}

function isLocalhostHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^\[?(?:fc|fd)[0-9a-f]{2}:/i.test(hostname) ||
    /^\[?fe80:/i.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  );
}

function safeSignupAssistBase(value) {
  try {
    const url = new URL(value || "https://signupassist.shipworx.ai");
    if (!["https:", "http:"].includes(url.protocol)) return "https://signupassist.shipworx.ai";
    if (url.username || url.password) return "https://signupassist.shipworx.ai";
    if (url.protocol === "http:" && !isLocalhostHostname(url.hostname.toLowerCase())) {
      return "https://signupassist.shipworx.ai";
    }
    return url.origin;
  } catch {
    return "https://signupassist.shipworx.ai";
  }
}

function buildHelperCodeUrl(helperBaseUrl) {
  const url = new URL("/api/helper/run-packet", safeSignupAssistBase(helperBaseUrl));
  return url.toString();
}

async function fetchHelperCode() {
  const helperCode = document.getElementById("helperCode").value.trim();
  if (!helperCode) {
    setStatus("Paste a helper code first.");
    return;
  }

  const endpoint = buildHelperCodeUrl(document.getElementById("helperBaseUrl")?.value);
  setStatus("Fetching helper code...");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ helperCode }),
    });
  } catch {
    setStatus("Unable to reach the helper-code endpoint.");
    return;
  }

  if (!response.ok) {
    setStatus(`Helper code fetch failed (${response.status}).`);
    return;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const fetchedHelperCode = payload?.helperCode || payload?.code || helperCode;
  const fetchedAssistMode = typeof payload?.assistMode === "boolean" ? payload.assistMode : undefined;
  const packet =
    payload?.signupassistRunPacket ||
    payload?.runPacket ||
    payload?.packet ||
    (payload?.mode === "supervised_autopilot" ? payload : null);

  await chrome.storage.local.set({ [STORAGE_KEYS.helperCode]: fetchedHelperCode });
  document.getElementById("helperCode").value = fetchedHelperCode;

  if (packet?.mode === "supervised_autopilot") {
    await chrome.storage.local.set({ [STORAGE_KEYS.runPacket]: packet });
    document.getElementById("runPacket").value = JSON.stringify(packet, null, 2);
    setSummary(summarizePacket(packet));
    setPacketDetails(packet);
  }

  if (typeof fetchedAssistMode === "boolean") {
    await saveAssistMode(fetchedAssistMode);
  }

  setHelperCodeSummary(helperCodeSummary(fetchedHelperCode, packet || null));
  setStatus(packet ? "Helper code loaded." : "Helper code saved.");
}

document.getElementById("save").addEventListener("click", saveProfile);
document.getElementById("savePacket").addEventListener("click", saveRunPacket);
document.getElementById("fetchHelperCode").addEventListener("click", fetchHelperCode);

document.getElementById("assistMode").addEventListener("change", async (event) => {
  await saveAssistMode(event.target.checked);
});

document.getElementById("scan").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab("SIGNUPASSIST_SCAN");
    setStatus(
      `Scanned ${result.fields} fields and ${result.buttons} buttons. Assist Mode: ${result.assistModeEnabled ? "on" : "off"}. Packet: ${result.runPacketLoaded ? "loaded" : "none"}.`,
    );
  } catch (error) {
    setStatus(error.message || "Unable to scan this page.");
  }
});

document.getElementById("fill").addEventListener("click", async () => {
  try {
    await saveProfile();
    const result = await sendToActiveTab("SIGNUPASSIST_FILL_KNOWN");
    setStatus(
      `Filled ${result.filled.length} fields. Paused on ${result.pauses.length}. Assist Mode: ${result.assistModeEnabled ? "on" : "off"}. Packet: ${result.runPacketLoaded ? "loaded" : "none"}.`,
    );
  } catch (error) {
    setStatus(error.message || "Unable to fill this page.");
  }
});

document.getElementById("safeContinue").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab("SIGNUPASSIST_SAFE_CONTINUE");
    setStatus(
      result.continued
        ? `Safe continue clicked "${result.clicked}".`
        : result.reason || "Safe continue paused.",
    );
  } catch (error) {
    setStatus(error.message || "Unable to continue this page.");
  }
});

document.getElementById("stop").addEventListener("click", async () => {
  try {
    await sendToActiveTab("SIGNUPASSIST_STOP");
    setStatus("Helper stopped on this tab.");
  } catch (error) {
    setStatus(error.message || "Unable to stop this page.");
  }
});

loadProfile();
