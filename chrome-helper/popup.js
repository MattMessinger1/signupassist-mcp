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
  const { signupassistProfile = {} } = await chrome.storage.local.get("signupassistProfile");
  profileFields.forEach((field) => {
    document.getElementById(field).value = signupassistProfile[field] || "";
  });
}

async function saveProfile() {
  const signupassistProfile = {};
  profileFields.forEach((field) => {
    signupassistProfile[field] = document.getElementById(field).value.trim();
  });
  await chrome.storage.local.set({ signupassistProfile });
  setStatus("Profile saved.");
}

document.getElementById("save").addEventListener("click", saveProfile);

document.getElementById("scan").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab("SIGNUPASSIST_SCAN");
    setStatus(`Scanned ${result.fields} fields and ${result.buttons} buttons.`);
  } catch (error) {
    setStatus(error.message || "Unable to scan this page.");
  }
});

document.getElementById("fill").addEventListener("click", async () => {
  try {
    await saveProfile();
    const result = await sendToActiveTab("SIGNUPASSIST_FILL_KNOWN");
    setStatus(`Filled ${result.filled.length} fields. Paused on ${result.pauses.length}.`);
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
