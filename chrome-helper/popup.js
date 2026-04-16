const profileFields = [
  "childFirstName",
  "childLastName",
  "childDob",
  "parentEmail",
  "parentPhone",
];

function setStatus(message) {
  document.getElementById("status").textContent = message;
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToActiveTab(type) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No active tab");
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function loadProfile() {
  const {
    signupassistProfile = {},
    signupassistRunPacket = null,
  } = await chrome.storage.local.get(["signupassistProfile", "signupassistRunPacket"]);
  profileFields.forEach((field) => {
    document.getElementById(field).value = signupassistProfile[field] || "";
  });

  if (signupassistRunPacket) {
    document.getElementById("runPacket").value = JSON.stringify(signupassistRunPacket, null, 2);
  }
  document.getElementById("packetSummary").textContent = summarizePacket(signupassistRunPacket);
}

async function saveProfile() {
  const signupassistProfile = {};
  profileFields.forEach((field) => {
    signupassistProfile[field] = document.getElementById(field).value.trim();
  });
  await chrome.storage.local.set({ signupassistProfile });
  setStatus("Profile saved.");
}

async function saveRunPacket() {
  const rawPacket = document.getElementById("runPacket").value.trim();
  if (!rawPacket) {
    await chrome.storage.local.remove("signupassistRunPacket");
    document.getElementById("packetSummary").textContent = "No run packet loaded.";
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

  await chrome.storage.local.set({ signupassistRunPacket: packet });
  document.getElementById("packetSummary").textContent = summarizePacket(packet);
  setStatus("Run packet saved.");
}

document.getElementById("save").addEventListener("click", saveProfile);
document.getElementById("savePacket").addEventListener("click", saveRunPacket);

document.getElementById("scan").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab("SIGNUPASSIST_SCAN");
    setStatus(`Scanned ${result.fields} fields and ${result.buttons} buttons. Packet: ${result.runPacketLoaded ? "loaded" : "none"}.`);
  } catch (error) {
    setStatus(error.message || "Unable to scan this page.");
  }
});

document.getElementById("fill").addEventListener("click", async () => {
  try {
    await saveProfile();
    const result = await sendToActiveTab("SIGNUPASSIST_FILL_KNOWN");
    setStatus(`Filled ${result.filled.length} fields. Paused on ${result.pauses.length}. Packet: ${result.runPacketLoaded ? "loaded" : "none"}.`);
  } catch (error) {
    setStatus(error.message || "Unable to fill this page.");
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
