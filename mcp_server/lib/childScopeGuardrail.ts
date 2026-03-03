export interface ChildScopeGuardInput {
  message?: string;
  action?: string;
  payload?: Record<string, any> | null;
}

export interface ChildScopeGuardResult {
  blocked: boolean;
  reason?: 'adult_signup_request';
}

const SIGNUP_INTENT_RE = /\b(sign\s*up|signup|register|registration|enroll|enrol|book|booking)\b/i;
const ADULT_AUDIENCE_RE = /\b(adults?|adult-only|18\+|21\+|over\s*18|grown[-\s]?ups?|seniors?)\b/i;
const ADULT_PARTICIPANT_RE = /\b(for\s+me|for\s+myself|register\s+me|enroll\s+me|book\s+me|my\s+(wife|husband|partner|boyfriend|girlfriend))\b/i;
const CHILD_CUE_RE = /\b(child|children|kid|kids|son|daughter|teen|youth|minor)\b/i;

function payloadRequestsAdults(payload?: Record<string, any> | null): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const audience = String(payload.audience ?? payload.requestedAudience ?? '').toLowerCase().trim();
  return audience === 'adult' || audience === 'adults';
}

export function evaluateChildRegistrationScope(input: ChildScopeGuardInput): ChildScopeGuardResult {
  const message = String(input.message || '').trim();

  if (payloadRequestsAdults(input.payload)) {
    return { blocked: true, reason: 'adult_signup_request' };
  }

  if (!message) return { blocked: false };

  const hasSignupIntent = SIGNUP_INTENT_RE.test(message);
  if (!hasSignupIntent) return { blocked: false };

  const adultCue = ADULT_AUDIENCE_RE.test(message) || ADULT_PARTICIPANT_RE.test(message);
  const childCue = CHILD_CUE_RE.test(message);

  if (adultCue && !childCue) {
    return { blocked: true, reason: 'adult_signup_request' };
  }

  return { blocked: false };
}

export function getChildScopeBlockedMessage(): string {
  return [
    "SignupAssist is focused on parent/guardian-managed child activity registration.",
    "I can’t help with adult-only signup requests here.",
    "If you need an adult registration, please register directly with the provider.",
    "I can still help you find and register classes for a child anytime."
  ].join(' ');
}
