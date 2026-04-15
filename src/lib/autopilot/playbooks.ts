export type AutopilotConfidence = "verified" | "beta";

export interface ProviderPlaybook {
  key: string;
  name: string;
  domains: string[];
  confidence: AutopilotConfidence;
  speedClaim: string;
  allowedActions: string[];
  stopConditions: string[];
  fixturePath?: string;
}

export const DEFAULT_ALLOWED_ACTIONS = [
  "Fill known family profile fields",
  "Select matched child or participant",
  "Choose exact matched program/session",
  "Click safe non-final navigation buttons",
  "Record every pause and parent approval",
];

export const DEFAULT_STOP_CONDITIONS = [
  "Login, 2FA, CAPTCHA, or password manager prompt",
  "Waiver, legal release, consent, or policy acceptance",
  "Payment screen or payment confirmation",
  "Final submit, register, checkout, or purchase button",
  "Unknown required field",
  "Medical, allergy, disability, insurance, or PHI-like field",
  "Price above cap or changed total",
  "Program/session mismatch",
  "Sold-out, waitlist, or substitution state",
];

export const PROVIDER_PLAYBOOKS: ProviderPlaybook[] = [
  {
    key: "active",
    name: "ACTIVE / ActiveNet",
    domains: ["active.com", "activecommunities.com", "activenetwork.com"],
    confidence: "verified",
    speedClaim: "Optimized for opening-minute registration on verified ACTIVE flows.",
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    stopConditions: DEFAULT_STOP_CONDITIONS,
    fixturePath: "chrome-helper/fixtures/active.html",
  },
  {
    key: "daysmart",
    name: "DaySmart / Dash",
    domains: ["daysmartrecreation.com", "dashplatform.com", "dashregistration.com"],
    confidence: "verified",
    speedClaim: "Optimized for verified DaySmart and Dash registration screens.",
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    stopConditions: DEFAULT_STOP_CONDITIONS,
    fixturePath: "chrome-helper/fixtures/daysmart.html",
  },
  {
    key: "amilia",
    name: "Amilia",
    domains: ["amilia.com"],
    confidence: "verified",
    speedClaim: "Optimized for verified Amilia class and camp signups.",
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    stopConditions: DEFAULT_STOP_CONDITIONS,
    fixturePath: "chrome-helper/fixtures/amilia.html",
  },
  {
    key: "civicrec-recdesk",
    name: "CivicRec / RecDesk",
    domains: ["civicrec.com", "recdesk.com"],
    confidence: "verified",
    speedClaim: "Optimized for verified municipal recreation registration flows.",
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    stopConditions: DEFAULT_STOP_CONDITIONS,
    fixturePath: "chrome-helper/fixtures/civicrec-recdesk.html",
  },
  {
    key: "campminder",
    name: "CampMinder",
    domains: ["campminder.com"],
    confidence: "verified",
    speedClaim: "Optimized for verified camp application and registration screens.",
    allowedActions: DEFAULT_ALLOWED_ACTIONS,
    stopConditions: DEFAULT_STOP_CONDITIONS,
    fixturePath: "chrome-helper/fixtures/campminder.html",
  },
  {
    key: "generic",
    name: "Generic beta provider",
    domains: [],
    confidence: "beta",
    speedClaim: "Conservative fill-only mode. Speed claims do not apply until verified.",
    allowedActions: [
      "Fill high-confidence known fields",
      "Record every pause and parent approval",
    ],
    stopConditions: DEFAULT_STOP_CONDITIONS,
  },
];

export const VERIFIED_PROVIDER_PLAYBOOKS = PROVIDER_PLAYBOOKS.filter(
  (playbook) => playbook.confidence === "verified",
);

export const GENERIC_PLAYBOOK = PROVIDER_PLAYBOOKS.find(
  (playbook) => playbook.key === "generic",
) as ProviderPlaybook;

export function findPlaybookByKey(key: string) {
  return PROVIDER_PLAYBOOKS.find((playbook) => playbook.key === key) || GENERIC_PLAYBOOK;
}

export function findPlaybookForUrl(urlValue: string) {
  let host = "";

  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return GENERIC_PLAYBOOK;
  }

  return (
    PROVIDER_PLAYBOOKS.find((playbook) =>
      playbook.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    ) || GENERIC_PLAYBOOK
  );
}
