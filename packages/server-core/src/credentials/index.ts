import crypto from "node:crypto";
import { requireServerEnv } from "../env";

/**
 * Credential encryption at rest.
 *
 * Used for Gmail refresh tokens and any other persisted secrets.
 * Algorithm: AES-256-GCM with random 12-byte IV per record.
 * Storage format: base64(iv) + "." + base64(ciphertext+tag).
 *
 * The encryption key is the 32-byte TOKEN_ENCRYPTION_KEY env var. If you
 * rotate the key, previously-encrypted values become unreadable — rotate
 * carefully by decrypting with the old key and re-encrypting with the new.
 */

export function encryptSecret(plain: string): string {
  const env = requireServerEnv();
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "utf8").subarray(0, 32);
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 bytes");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${Buffer.concat([enc, tag]).toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const env = requireServerEnv();
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "utf8").subarray(0, 32);
  const [ivB64, payloadB64] = stored.split(".");
  if (!ivB64 || !payloadB64) throw new Error("Malformed ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  const tag = payload.subarray(payload.length - 16);
  const enc = payload.subarray(0, payload.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Validate a credential without storing it. Used by the settings UI to give
 * the user immediate feedback. Never returns the secret to the client.
 */
export function redactForClient(label: string, value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${label}: ${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}
