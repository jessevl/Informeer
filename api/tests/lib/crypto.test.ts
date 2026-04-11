import { describe, test, expect } from 'bun:test';
import { hashPassword, verifyPassword, encrypt, decrypt } from '../../src/lib/crypto.ts';

describe('hashPassword / verifyPassword', () => {
  test('hashes and verifies a password', async () => {
    const hash = await hashPassword('my-secret');
    expect(hash).toBeString();
    expect(hash).not.toBe('my-secret');
    expect(await verifyPassword('my-secret', hash)).toBe(true);
  });

  test('rejects wrong password', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  test('produces different hashes for same input (bcrypt salting)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
    // Both should still verify
    expect(await verifyPassword('same', h1)).toBe(true);
    expect(await verifyPassword('same', h2)).toBe(true);
  });
});

describe('encrypt / decrypt (AES-256-GCM)', () => {
  const key = 'test-secret-key-for-encryption';

  test('roundtrip works', () => {
    const plaintext = 'Hello, World!';
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });

  test('different plaintexts produce different ciphertexts', () => {
    const e1 = encrypt('aaa', key);
    const e2 = encrypt('bbb', key);
    expect(e1).not.toBe(e2);
  });

  test('same plaintext produces different ciphertexts (random IV)', () => {
    const e1 = encrypt('same', key);
    const e2 = encrypt('same', key);
    expect(e1).not.toBe(e2);
    // Both decrypt to the same value
    expect(decrypt(e1, key)).toBe('same');
    expect(decrypt(e2, key)).toBe('same');
  });

  test('wrong key fails to decrypt', () => {
    const encrypted = encrypt('secret', key);
    expect(() => decrypt(encrypted, 'wrong-key')).toThrow();
  });

  test('handles empty string', () => {
    const encrypted = encrypt('', key);
    expect(decrypt(encrypted, key)).toBe('');
  });

  test('handles unicode', () => {
    const plaintext = '日本語テスト 🎉';
    const encrypted = encrypt(plaintext, key);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });
});
