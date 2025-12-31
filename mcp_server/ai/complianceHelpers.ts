/**
 * Compliance helpers for SignupAssist.
 *
 * Purpose:
 * - Keep messaging aligned with ChatGPT Apps requirements (explicit consent, auditability, PCI hygiene)
 * - Avoid coupling production runtime behavior to internal "Design DNA" docs/validators
 */

/**
 * Add a short "Responsible Delegate" reminder.
 * (Used on consequential steps where we want to reinforce consent + audit trail.)
 */
export function addResponsibleDelegateFooter(message: string): string {
  return `${message}

📋 *SignupAssist acts as your Responsible Delegate:* we only proceed with your explicit consent, we log every consequential action for your review, and we charge only upon successful registration.`;
}

/**
 * Add a short security note for API providers (Stripe hosted checkout / provider handles card data).
 */
export function addAPISecurityContext(message: string, providerName: string): string {
  return `${message}

🔒 *Your data stays secure:* ${providerName} handles payment processing via official checkout. SignupAssist never stores card numbers.`;
}


