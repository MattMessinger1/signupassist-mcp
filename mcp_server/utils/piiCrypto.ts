import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface EncryptedPIIEnvelope {
  v: number;
  alg: typeof ALGORITHM;
  kid: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

function normalizeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (b64.test(trimmed) && trimmed.length >= 43) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) return decoded;
  }

  const hex = /^[A-Fa-f0-9]{64}$/;
  if (hex.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'hex');
    if (decoded.length === 32) return decoded;
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === 32) return utf8;

  throw new Error('PII key must be 32 bytes (base64, hex, or raw UTF-8)');
}

function loadKeyring(): Map<string, Buffer> {
  const keyring = new Map<string, Buffer>();
  const activeKeyRaw = process.env.PII_ENCRYPTION_KEY;
  if (!activeKeyRaw) {
    throw new Error('Missing required env var: PII_ENCRYPTION_KEY');
  }

  const activeKid = process.env.PII_ENCRYPTION_KEY_ID || 'v1';
  keyring.set(activeKid, normalizeKey(activeKeyRaw));

  const historicalRaw = process.env.PII_ENCRYPTION_KEYRING_JSON;
  if (historicalRaw) {
    const parsed = JSON.parse(historicalRaw) as Record<string, string>;
    Object.entries(parsed).forEach(([kid, key]) => {
      if (!keyring.has(kid)) {
        keyring.set(kid, normalizeKey(key));
      }
    });
  }

  return keyring;
}

export function encryptPII(plaintext: string): EncryptedPIIEnvelope {
  const keyring = loadKeyring();
  const kid = process.env.PII_ENCRYPTION_KEY_ID || 'v1';
  const key = keyring.get(kid);
  if (!key) throw new Error(`No encryption key found for kid=${kid}`);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: ALGORITHM,
    kid,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64')
  };
}

export function decryptPII(envelope: EncryptedPIIEnvelope): string {
  if (!envelope || envelope.alg !== ALGORITHM) {
    throw new Error('Invalid encrypted payload format');
  }

  const keyring = loadKeyring();
  const key = keyring.get(envelope.kid);
  if (!key) {
    throw new Error(`No decryption key available for kid=${envelope.kid}`);
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
