import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// --- Bcrypt-like password hashing using Bun's built-in ---

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// --- AES-256-GCM encryption for secrets at rest ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encrypt(plaintext: string, secretKey: string): string {
  const key = deriveKey(secretKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encoded: string, secretKey: string): string {
  const key = deriveKey(secretKey);
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}
