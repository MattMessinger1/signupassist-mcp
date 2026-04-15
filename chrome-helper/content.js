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
  "captcha",
  "password",
];

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

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
    return map[char];
  });
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

function scanPage() {
  const fields = Array.from(document.querySelectorAll("input, textarea, select"));
  const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a[role='button']"));
  const pauses = [];
  const safeButtons = [];
  const forbiddenButtons = [];

  fields.forEach((field) => {
    const label = getFieldLabel(field);
    if (isSensitive(label, field)) {
      field.classList.add("signupassist-paused");
      pauses.push(`Sensitive field: ${label || field.tagName.toLowerCase()}`);
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

  overlay("Page scanned. Green fields were filled, blue buttons are safe navigation, red items require parent approval.", [
    `${fields.length} fields`,
    `${safeButtons.length} safe navigation buttons`,
    `${forbiddenButtons.length} final-action buttons`,
    `${pauses.length} pause conditions`,
  ]);

  return {
    fields: fields.length,
    buttons: buttons.length,
    pauses,
    safeButtons,
    forbiddenButtons,
  };
}

async function fillKnownFields() {
  const { signupassistProfile = {} } = await chrome.storage.local.get("signupassistProfile");
  const fields = Array.from(document.querySelectorAll("input, textarea"));
  const filled = [];
  const pauses = [];

  fields.forEach((field) => {
    if (field.disabled || field.readOnly || field.value) return;
    const label = getFieldLabel(field);

    if (isSensitive(label, field)) {
      field.classList.add("signupassist-paused");
      pauses.push(label || field.getAttribute("name") || "Sensitive field");
      return;
    }

    const match = matchProfileField(label);
    if (!match) return;

    const value = signupassistProfile[match.field];
    if (!value) return;

    fillField(field, value);
    filled.push(label || match.field);
  });

  overlay("Prepared fields filled. Parent approval is still required for final submit, waivers, payments, and unknown required fields.", [
    `${filled.length} fields filled`,
    `${pauses.length} pause conditions`,
  ]);

  return { filled, pauses };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SIGNUPASSIST_SCAN") {
    sendResponse(scanPage());
    return true;
  }

  if (message?.type === "SIGNUPASSIST_FILL_KNOWN") {
    fillKnownFields().then(sendResponse);
    return true;
  }

  if (message?.type === "SIGNUPASSIST_STOP") {
    document.getElementById("signupassist-overlay")?.remove();
    document.querySelectorAll(".signupassist-filled, .signupassist-paused, .signupassist-safe-button, .signupassist-forbidden-button")
      .forEach((node) => {
        node.classList.remove("signupassist-filled", "signupassist-paused", "signupassist-safe-button", "signupassist-forbidden-button");
      });
    sendResponse({ stopped: true });
    return true;
  }

  return false;
});
