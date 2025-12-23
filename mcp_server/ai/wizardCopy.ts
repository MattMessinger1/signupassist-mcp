/**
 * Wizard Step Copy Helpers
 * Reusable helpers for consistent "Step N/M" headers and trust lines
 * Used across API-first message templates for ChatGPT compatibility
 */

export type WizardStep = 1 | 2 | 3 | 4;

export function renderStepHeader(args: {
  step: WizardStep;
  title: string;
  subtitle?: string;
  total?: number;
}): string {
  const total = args.total ?? 4;
  const header = `Step ${args.step}/${total} — ${args.title}`;
  return args.subtitle ? `${header}\n${args.subtitle}` : header;
}

/**
 * Short trust lines (V1 no-widget friendly)
 * Keep these calm, matter-of-fact, and consistent.
 */
export function renderTrustLine(kind: "stripe" | "privacy" | "confirm"): string {
  switch (kind) {
    case "stripe":
      return `🔒 Secure payment: Stripe hosts the card form. SignupAssist never sees or stores card numbers.`;
    case "privacy":
      return `🔐 Privacy: I'll only ask for what the provider requires, and I'll summarize before anything is submitted.`;
    case "confirm":
      return `✅ I'll ask you to confirm before any registration is submitted.`;
    default:
      return ``;
  }
}

export function renderBullets(items: string[], max = 8): string {
  return items.slice(0, max).map(i => `• ${i}`).join("\n");
}
