import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptPII, encryptPII } from '../utils/piiCrypto.js';

process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PII_ENCRYPTION_KEY_ID = 'v-current';
process.env.PII_ENCRYPTION_KEYRING_JSON = JSON.stringify({
  'v-legacy': Buffer.alloc(32, 3).toString('base64')
});

test('encryptPII/decryptPII roundtrip', () => {
  const message = 'sensitive-value-123';
  const encrypted = encryptPII(message);

  assert.equal(encrypted.alg, 'aes-256-gcm');
  assert.equal(encrypted.kid, 'v-current');
  assert.ok(encrypted.iv);
  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.tag);

  const decrypted = decryptPII(encrypted);
  assert.equal(decrypted, message);
});

test('decryptPII can read legacy-kid ciphertext from keyring', () => {
  const originalKey = process.env.PII_ENCRYPTION_KEY;
  const originalKid = process.env.PII_ENCRYPTION_KEY_ID;

  process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
  process.env.PII_ENCRYPTION_KEY_ID = 'v-legacy';
  const encrypted = encryptPII('legacy-secret');

  process.env.PII_ENCRYPTION_KEY = originalKey;
  process.env.PII_ENCRYPTION_KEY_ID = originalKid;

  const decrypted = decryptPII(encrypted);
  assert.equal(decrypted, 'legacy-secret');
});
