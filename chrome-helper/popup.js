const profileFields = [
  "childFirstName",
  "childLastName",
  "childDob",
  "parentEmail",
  "parentPhone",
];

const NEW_PROFILE_VALUE = "__new__";

const STORAGE_KEYS = {
  runPacket: "signupassistRunPacket",
  assistMode: "signupassistAssistMode",
  helperCode: "signupassistHelperCode",
  profile: "signupassistProfile",
  childProfiles: "signupassistChildProfiles",
  selectedProfileId: "signupassistSelectedProfileId",
  setupMetadata: "signupassistSetupMetadata",
};

let childProfiles = [];
let selectedProfileId = "";
let currentPacket = null;
let currentPacketProviderName = "";
let packetProviderState = "needs_helper_code";

function trimValue(value) {
  return String(value ?? "").trim();
}

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

function setSetupState(state) {
  const node = document.getElementById("setupState");
  node.dataset.state = state;
  node.textContent = state;
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

function truncateMiddle(value, left = 10, right = 8) {
  if (!value) return "";
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function helperCodeSummary(helperCode, packet) {
  if (!helperCode && packet?.target?.providerName) {
    return `Helper code redeemed -> ${packet.target.providerName}`;
  }
  if (!helperCode) return "No helper code loaded.";
  const codeLabel = truncateMiddle(helperCode);
  if (!packet?.target?.providerName) return `Helper code saved: ${codeLabel}`;
  return `Helper code ${codeLabel} -> ${packet.target.providerName}`;
}

function profileValue(profile, field) {
  return trimValue(profile?.[field] || "");
}

function profileDisplayName(profile, index = 0) {
  const parts = [profileValue(profile, "childFirstName"), profileValue(profile, "childLastName")].filter(Boolean);
  return parts.length ? parts.join(" ") : `Profile ${index + 1}`;
}

function profileFirstName(profile) {
  return firstNameFromName(profileValue(profile, "childFirstName") || profileValue(profile, "name") || profileValue(profile, "childName"));
}

function firstNameFromName(value) {
  const cleaned = trimValue(value).replace(/[(),.]/g, " ").replace(/\s+/g, " ");
  return cleaned ? cleaned.split(" ")[0] : "";
}

function hasProfileData(profile) {
  return profileFields.some((field) => Boolean(profileValue(profile, field)));
}

function collectProfileFromFields() {
  const profile = {};
  profileFields.forEach((field) => {
    profile[field] = trimValue(document.getElementById(field).value);
  });
  return profile;
}

function applyProfileToFields(profile) {
  profileFields.forEach((field) => {
    document.getElementById(field).value = profileValue(profile, field);
  });
}

function normalizeProfileRecord(profile, fallbackId) {
  const normalized = { id: trimValue(profile?.id) || fallbackId || `profile-${Date.now()}` };
  profileFields.forEach((field) => {
    normalized[field] = profileValue(profile, field);
  });
  return normalized;
}

function toLegacyProfile(profile) {
  const legacy = {};
  profileFields.forEach((field) => {
    legacy[field] = profileValue(profile, field);
  });
  return legacy;
}

function resolveSelectedProfile() {
  return childProfiles.find((profile) => profile.id === selectedProfileId) || null;
}

function currentProfileLabel() {
  const fieldsProfile = collectProfileFromFields();
  if (hasProfileData(fieldsProfile)) return profileDisplayName(fieldsProfile, 0);
  const selected = resolveSelectedProfile();
  if (selected) return profileDisplayName(selected, childProfiles.indexOf(selected));
  return "Choose in SignupAssist";
}

function renderProfileSelect() {
  const select = document.getElementById("profileSelect");
  const existingValue = selectedProfileId && resolveSelectedProfile() ? selectedProfileId : NEW_PROFILE_VALUE;
  select.innerHTML = "";

  const newOption = document.createElement("option");
  newOption.value = NEW_PROFILE_VALUE;
  newOption.textContent = "+ New profile";
  select.appendChild(newOption);

  childProfiles.forEach((profile, index) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profileDisplayName(profile, index);
    select.appendChild(option);
  });

  select.value = existingValue;
}

async function persistProfilesState() {
  const selectedProfile = resolveSelectedProfile();
  await chrome.storage.local.set({
    [STORAGE_KEYS.childProfiles]: childProfiles,
    [STORAGE_KEYS.selectedProfileId]: selectedProfile?.id || "",
    [STORAGE_KEYS.profile]: selectedProfile ? toLegacyProfile(selectedProfile) : {},
  });
}

function determineSetupState() {
  if (!hasProfileData(collectProfileFromFields())) return "needs_profile";
  if (!currentPacket) return "needs_helper_code";
  return packetProviderState;
}

function refreshPacketDetails(packet) {
  const provider = packet?.target?.providerName || "No packet loaded";
  const child = packet?.target?.child?.name || currentProfileLabel();
  const cap = typeof packet?.target?.maxTotalCents === "number"
    ? `$${(packet.target.maxTotalCents / 100).toFixed(2)}`
    : "Not set";

  document.getElementById("providerDetected").textContent = provider;
  document.getElementById("childSelected").textContent = child;
  document.getElementById("priceCap").textContent = cap;
}

function renderDerivedState() {
  const helperCodeInput = trimValue(document.getElementById("helperCode").value);
  const helperCode = normalizeHelperCodeInput(helperCodeInput) || helperCodeInput;
  const state = determineSetupState();
  setSetupState(state);
  setSummary(summarizePacket(currentPacket));
  setHelperCodeSummary(helperCodeSummary(helperCode, currentPacket));
  refreshPacketDetails(currentPacket);
}

async function selectProfile(profileId, { persist = true } = {}) {
  if (!profileId || profileId === NEW_PROFILE_VALUE) {
    selectedProfileId = "";
    applyProfileToFields({});
  } else {
    const profile = childProfiles.find((item) => item.id === profileId) || null;
    selectedProfileId = profile?.id || "";
    applyProfileToFields(profile || {});
  }

  renderProfileSelect();
  if (persist) await persistProfilesState();
  renderDerivedState();
}

async function autoSelectProfileFromPacket(packet) {
  const packetFirstName = firstNameFromName(packet?.target?.child?.name);
  if (!packetFirstName) return false;

  const match = childProfiles.find((profile) => {
    const firstName = profileFirstName(profile);
    return firstName && firstName.toLowerCase() === packetFirstName.toLowerCase();
  });

  if (!match) return false;
  if (selectedProfileId === match.id) {
    renderProfileSelect();
    return false;
  }

  selectedProfileId = match.id;
  applyProfileToFields(match);
  renderProfileSelect();
  await persistProfilesState();
  return true;
}

function syncPacketState(nextPacket) {
  const previousProvider = currentPacketProviderName;
  currentPacket = nextPacket || null;
  currentPacketProviderName = nextPacket?.target?.providerName || "";
  packetProviderState =
    previousProvider &&
    currentPacketProviderName &&
    previousProvider !== currentPacketProviderName
      ? "ready_different_provider"
      : "ready_same_provider";
}

function buildSetupMetadata(packet) {
  if (!packet?.target) return null;
  return {
    state: packetProviderState,
    providerKey: packet.target.providerKey || "",
    providerName: packet.target.providerName || "",
    targetUrl: packet.target.url || "",
  };
}

async function persistPacketAndSetup(packet) {
  if (!packet) {
    await chrome.storage.local.remove(STORAGE_KEYS.runPacket);
    await chrome.storage.local.remove(STORAGE_KEYS.setupMetadata);
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.runPacket]: packet,
    [STORAGE_KEYS.setupMetadata]: buildSetupMetadata(packet),
  });
}

async function readStoredState() {
  const state = await chrome.storage.local.get([
    STORAGE_KEYS.profile,
    STORAGE_KEYS.childProfiles,
    STORAGE_KEYS.selectedProfileId,
    STORAGE_KEYS.runPacket,
    STORAGE_KEYS.assistMode,
    STORAGE_KEYS.helperCode,
  ]);

  return {
    legacyProfile: state[STORAGE_KEYS.profile] || {},
    childProfiles: Array.isArray(state[STORAGE_KEYS.childProfiles]) ? state[STORAGE_KEYS.childProfiles] : [],
    selectedProfileId: state[STORAGE_KEYS.selectedProfileId] || "",
    signupassistRunPacket: state[STORAGE_KEYS.runPacket] || null,
    signupassistAssistMode: Boolean(state[STORAGE_KEYS.assistMode]),
    signupassistHelperCode: state[STORAGE_KEYS.helperCode] || "",
  };
}

async function loadProfile() {
  const {
    legacyProfile,
    childProfiles: storedChildProfiles,
    selectedProfileId: storedSelectedProfileId,
    signupassistRunPacket,
    signupassistAssistMode,
    signupassistHelperCode,
  } = await readStoredState();

  childProfiles = storedChildProfiles.map((profile, index) => normalizeProfileRecord(profile, profile?.id || `profile-${index + 1}`));
  const legacyHasData = hasProfileData(legacyProfile);

  if (!childProfiles.length && legacyHasData) {
    childProfiles = [normalizeProfileRecord(legacyProfile, "legacy-profile")];
  }

  selectedProfileId = childProfiles.some((profile) => profile.id === storedSelectedProfileId)
    ? storedSelectedProfileId
    : childProfiles[0]?.id || "";

  renderProfileSelect();

  const selectedProfile = resolveSelectedProfile();
  applyProfileToFields(selectedProfile || {});
  document.getElementById("helperCode").value = signupassistHelperCode;

  if (signupassistRunPacket && signupassistRunPacket.mode === "supervised_autopilot") {
    syncPacketState(signupassistRunPacket);
    document.getElementById("runPacket").value = JSON.stringify(signupassistRunPacket, null, 2);
    await autoSelectProfileFromPacket(signupassistRunPacket);
    renderPacketSummary(signupassistRunPacket);
  } else {
    syncPacketState(null);
    document.getElementById("runPacket").value = "";
    renderPacketSummary(null);
  }

  if (!storedChildProfiles.length && legacyHasData) {
    await persistProfilesState();
  }

  setAssistModeSummary(signupassistAssistMode);
  renderDerivedState();
}

function renderPacketSummary(packet) {
  setSummary(summarizePacket(packet));
  setHelperCodeSummary(helperCodeSummary(trimValue(document.getElementById("helperCode").value), packet));
  refreshPacketDetails(packet);
  setSetupState(determineSetupState());
}

function updatePacketView(packet) {
  syncPacketState(packet);
  document.getElementById("runPacket").value = packet ? JSON.stringify(packet, null, 2) : "";
  renderPacketSummary(packet);
}

async function saveProfile() {
  const profile = collectProfileFromFields();
  if (!hasProfileData(profile)) {
    setStatus("Enter a profile first.");
    renderDerivedState();
    return;
  }

  const selected = resolveSelectedProfile();
  let nextProfiles = childProfiles.slice();
  let nextSelectedId = selected?.id || "";

  if (!selected || document.getElementById("profileSelect").value === NEW_PROFILE_VALUE) {
    nextSelectedId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    nextProfiles = [...nextProfiles, { id: nextSelectedId, ...profile }];
  } else {
    nextProfiles = nextProfiles.map((item) => (item.id === selected.id ? { ...item, ...profile } : item));
  }

  childProfiles = nextProfiles.map((item, index) => normalizeProfileRecord(item, item.id || `profile-${index + 1}`));
  selectedProfileId = nextSelectedId;
  renderProfileSelect();
  await persistProfilesState();
  renderDerivedState();
  setStatus("Profile saved.");
}

function normalizeHelperCodeInput(rawValue) {
  const value = trimValue(rawValue);
  if (!value) return "";

  try {
    const url = new URL(value);
    const code =
      url.searchParams.get("helperCode") ||
      url.searchParams.get("helper_code") ||
      url.searchParams.get("code") ||
      "";
    return trimValue(code);
  } catch {
    if (value.split(".").length >= 3 && !/\s/.test(value)) {
      return value;
    }
    const match = value.match(/(?:helperCode|helper_code|code)=([^&\s]+)/i);
    if (match) return decodeURIComponent(match[1]);
    return value;
  }
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

function buildHelperCodeUrl(helperBaseUrl) {
  const url = new URL("/api/helper/run-packet", safeSignupAssistBase(helperBaseUrl));
  return url.toString();
}

async function fetchHelperCode() {
  const helperCodeField = document.getElementById("helperCode");
  const helperCode = normalizeHelperCodeInput(helperCodeField.value);
  if (!helperCode) {
    setStatus("Paste a helper code first.");
    return;
  }

  const endpoint = buildHelperCodeUrl(document.getElementById("helperBaseUrl")?.value);
  helperCodeField.value = helperCode;
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

  const fetchedHelperCode = normalizeHelperCodeInput(payload?.helperCode || payload?.code || helperCode);
  const fetchedAssistMode = typeof payload?.assistMode === "boolean" ? payload.assistMode : undefined;
  const packet =
    payload?.signupassistRunPacket ||
    payload?.runPacket ||
    payload?.packet ||
    (payload?.mode === "supervised_autopilot" ? payload : null);

  const previousProviderName = currentPacketProviderName;
  if (packet?.mode === "supervised_autopilot") {
    updatePacketView(packet);
    await autoSelectProfileFromPacket(packet);
    await persistPacketAndSetup(packet);
    await chrome.storage.local.remove(STORAGE_KEYS.helperCode);
    helperCodeField.value = "";
  } else {
    await chrome.storage.local.set({ [STORAGE_KEYS.helperCode]: fetchedHelperCode });
    helperCodeField.value = fetchedHelperCode;
  }

  if (typeof fetchedAssistMode === "boolean") {
    await saveAssistMode(fetchedAssistMode);
  }

  renderDerivedState();
  setStatus(
    packet && packetProviderState === "ready_different_provider" && previousProviderName && packet?.target?.providerName
      ? `Helper code loaded; provider switched from ${previousProviderName} to ${packet.target.providerName}.`
      : packet
        ? "Helper code loaded."
        : "Helper code saved.",
  );
}

async function saveRunPacket() {
  const rawPacket = document.getElementById("runPacket").value.trim();
  if (!rawPacket) {
    await persistPacketAndSetup(null);
    updatePacketView(null);
    renderDerivedState();
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

  const previousProviderName = currentPacketProviderName;
  updatePacketView(packet);
  await autoSelectProfileFromPacket(packet);
  await persistPacketAndSetup(packet);

  renderDerivedState();
  setStatus(
    packetProviderState === "ready_different_provider" &&
    previousProviderName &&
    packet?.target?.providerName
      ? `Provider switched from ${previousProviderName} to ${packet.target.providerName}.`
      : "Run packet saved.",
  );
}

async function saveAssistMode(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.assistMode]: Boolean(enabled) });
  setAssistModeSummary(Boolean(enabled));
  setStatus(enabled ? "Assist Mode enabled." : "Assist Mode paused.");
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

document.getElementById("save").addEventListener("click", saveProfile);
document.getElementById("savePacket").addEventListener("click", saveRunPacket);
document.getElementById("fetchHelperCode").addEventListener("click", fetchHelperCode);

document.getElementById("assistMode").addEventListener("change", async (event) => {
  await saveAssistMode(event.target.checked);
});

document.getElementById("profileSelect").addEventListener("change", async (event) => {
  await selectProfile(event.target.value);
});

profileFields.forEach((field) => {
  document.getElementById(field).addEventListener("input", () => {
    renderDerivedState();
  });
});

document.getElementById("helperCode").addEventListener("input", () => {
  renderDerivedState();
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
