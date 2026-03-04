import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

export interface EncryptedPayload {
  iv: string;
  content: string;
  tag: string;
}

/**
 * Encrypt a string using AES-256-GCM. The secret key must be provided via
 * process.env.PII_ENCRYPTION_KEY as a 64-character hex string (32 bytes).
 */
export function encryptString(text: string): EncryptedPayload {
  const keyHex = process.env.PII_ENCRYPTION_KEY || '';
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error('Invalid PII_ENCRYPTION_KEY length. Must be 64 hex chars (32 bytes).');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    content: encrypted,
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an encrypted payload. Requires the same secret key and algorithm used during encryption.
 */
export function decryptString(payload: EncryptedPayload): string {
  const { iv, content, tag } = payload;
  const keyHex = process.env.PII_ENCRYPTION_KEY || '';
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error('Invalid PII_ENCRYPTION_KEY length. Must be 64 hex chars (32 bytes).');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
