export interface ChildScopeGuardInput {
  message?: string;
  action?: string;
  payload?: Record<string, any> | null;
}

export interface ChildScopeGuardResult {
  blocked: boolean;
  reason?: 'adult_signup_request';
}

export interface ChildScopeOutOfScopeResponse {
  message: string;
  metadata: {
    suppressWizardHeader: true;
    outOfScope: true;
    reason: 'adult_signup_request';
  };
  context: {
    step: 'BROWSE';
  };
}

const SIGNUP_INTENT_RE = /\b(sign\s*up|signup|register|registration|enroll|enrol|book|booking|inscri(?:bir(?:me)?|pcion)|registrar(?:me)?|matricul(?:a|ar(?:me)?|acion)|inscri(?:re|ption)|anmelden|anmeldung|cadastr(?:ar|o)|inscricao)\b/i;
const ADULT_AUDIENCE_RE = /\b(adults?|adult[-\s]?only|(?:18(?:\+|\s*plus)?|21(?:\+|\s*plus)?|over\s*18)|grown[-\s]?ups?|seniors?|adultos?|adultes?|erwachsene|maiores?\s+de\s+edad)\b/i;
const ADULT_PARTICIPANT_RE = /\b(for\s+me|for\s+myself|register\s+me|enroll\s+me|book\s+me|my\s+(wife|husband|partner|boyfriend|girlfriend)|para\s+mi|para\s+mim|registrarme|inscribirme|matricularme|pour\s+moi|f[uü]r\s+mich)\b/i;
const CHILD_CUE_RE = /\b(child|children|kid|kids|son|daughter|teen|youth|minor|hij[oa]s?|niñ[oa]s?|nin[oa]s?|enfants?|criancas?|crianças?|kind(?:er)?|jugend)\b/i;

const SIGNUP_INTENT_COMPACT_TERMS = [
  'signup',
  'register',
  'registration',
  'enroll',
  'enrol',
  'book',
  'booking',
  'inscribir',
  'inscribirme',
  'inscripcion',
  'registrarme',
  'matricular',
  'matricularme',
  'matriculacion',
  'inscrire',
  'inscription',
  'anmelden',
  'anmeldung',
  'cadastrar',
  'cadastro',
  'inscricao',
];

const ADULT_CUE_COMPACT_TERMS = [
  'adult',
  'adults',
  'adultonly',
  '18',
  '21',
  'over18',
  'grownup',
  'grownups',
  'senior',
  'seniors',
  'adulto',
  'adultos',
  'adulte',
  'adultes',
  'erwachsene',
  'mayordeedad',
  'maioresdeedad',
  'forme',
  'formyself',
  'registerme',
  'enrollme',
  'bookme',
  'parami',
  'paramim',
  'pourmoi',
  'furmich',
];

const CHILD_CUE_COMPACT_TERMS = [
  'child',
  'children',
  'kid',
  'kids',
  'daughter',
  'teen',
  'youth',
  'minor',
  'hijo',
  'hija',
  'hijos',
  'hijas',
  'nino',
  'nina',
  'ninos',
  'ninas',
  'enfant',
  'enfants',
  'crianca',
  'criancas',
  'kind',
  'kinder',
  'jugend',
];

function normalizeGuardrailText(message: string): { normalized: string; compact: string } {
  const withoutDiacritics = message
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const normalized = withoutDiacritics
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const compact = withoutDiacritics.replace(/[^\p{L}\p{N}]+/gu, '');

  return { normalized, compact };
}

function includesAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

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

  const { normalized, compact } = normalizeGuardrailText(message);
  const hasSignupIntent = SIGNUP_INTENT_RE.test(normalized) || includesAnyTerm(compact, SIGNUP_INTENT_COMPACT_TERMS);
  if (!hasSignupIntent) return { blocked: false };

  const adultCue =
    ADULT_AUDIENCE_RE.test(normalized) ||
    ADULT_PARTICIPANT_RE.test(normalized) ||
    includesAnyTerm(compact, ADULT_CUE_COMPACT_TERMS);
  const childCue = CHILD_CUE_RE.test(normalized) || includesAnyTerm(compact, CHILD_CUE_COMPACT_TERMS);

  if (adultCue && !childCue) {
    return { blocked: true, reason: 'adult_signup_request' };
  }

  return { blocked: false };
}

export function getChildScopeBlockedMessage(): string {
  return [
    "SignupAssist is focused on youth activity enrollment.",
    "I can’t help with adult-only signup requests here.",
    "If you need an adult registration, please register directly with the provider.",
    "I can still help you find and register for activities anytime."
  ].join(' ');
}

export function buildChildScopeOutOfScopeResponse(): ChildScopeOutOfScopeResponse {
  return {
    message: getChildScopeBlockedMessage(),
    metadata: {
      suppressWizardHeader: true,
      outOfScope: true,
      reason: 'adult_signup_request',
    },
    context: {
      step: 'BROWSE',
    },
  };
}
