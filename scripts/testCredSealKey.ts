// scripts/testCredSealKey.ts
import crypto from "crypto";
import "dotenv/config";

// --- Configuration ---
const key = process.env.CRED_SEAL_KEY;

// --- Step 1: Sanity check ---
if (!key) {
  console.error("❌ Missing CRED_SEAL_KEY in environment");
  process.exit(1);
}

if (Buffer.from(key, "base64").length < 32) {
  console.error("❌ CRED_SEAL_KEY must be at least 32 bytes (base64 encoded)");
  process.exit(1);
}

// --- Step 2: Simple seal/unseal test ---
try {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    iv
  );
  const plaintext = "test_secret_value";
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const ciphertext = Buffer.concat([iv, tag, encrypted]).toString("base64");

  // Decrypt to verify
  const buf = Buffer.from(ciphertext, "base64");
  const iv2 = buf.subarray(0, 12);
  const tag2 = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    iv2
  );
  decipher.setAuthTag(tag2);
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");

  if (decrypted === plaintext) {
    console.log("✅ CRED_SEAL_KEY encryption/decryption verified successfully!");
    process.exit(0);
  } else {
    console.error("❌ Decryption failed — plaintext mismatch");
    process.exit(1);
  }
} catch (error) {
  console.error("❌ CRED_SEAL_KEY test failed:", (error as Error).message);
  process.exit(1);
}
