import { describe, it, expect } from 'vitest';
import { makeTestContext } from './helpers.js';
import { encryptGcm, decryptGcm } from '../src/crypto/encryption.js';
import { buildAad } from '../src/crypto/aad.js';
import { sha256Hex } from '../src/crypto/integrity.js';
import { AppError } from '../src/errors.js';

const KEY = Buffer.from('k'.repeat(32), 'utf8');

function context(overrides: Partial<Parameters<typeof buildAad>[0]> = {}) {
  return {
    realm: 'employees',
    bucket: 'test-bucket',
    objectKey: 'documents/opaque-1',
    contentType: 'application/pdf',
    ...overrides,
  };
}

describe('AES-256-GCM encryption pipeline', () => {
  it('round-trips plaintext with the correct auth tag and integrity hash', () => {
    const plain = Buffer.from('payroll record - confidential');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    expect(sealed.blob.length).toBe(12 + plain.length + 16);
    expect(sealed.integritySha256).toHaveLength(64);
    const aad = buildAad(context());
    expect(sealed.aadHex).toBe(aad.toString('hex'));
    expect(sha256Hex(plain)).not.toBe(sealed.integritySha256);

    const open = decryptGcm(
      sealed.blob,
      context(),
      {
        blob: sealed.blob,
        keyId: sealed.keyId,
        keyVersion: sealed.keyVersion,
        aadHex: sealed.aadHex,
        integritySha256: sealed.integritySha256,
      },
      KEY,
    );
    expect(open.toString('utf8')).toBe('payroll record - confidential');
  });

  it('rejects a tampered ciphertext (single flipped byte) via GCM tag verification', () => {
    const plain = Buffer.from('sensitive employee document body');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    const tampered = Buffer.from(sealed.blob);
    tampered.writeUInt8(tampered.readUInt8(20) ^ 0x01, 20);
    expect(() =>
      decryptGcm(
        tampered,
        context(),
        {
          blob: tampered,
          keyId: sealed.keyId,
          keyVersion: sealed.keyVersion,
          aadHex: sealed.aadHex,
          integritySha256: sealed.integritySha256,
        },
        KEY,
      ),
    ).toThrow(AppError);
  });

  it('rejects when the AAD context does not match the record', () => {
    const plain = Buffer.from('context binding must fail');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    expect(() =>
      decryptGcm(
        sealed.blob,
        context({ objectKey: 'documents/other-object' }),
        {
          blob: sealed.blob,
          keyId: sealed.keyId,
          keyVersion: sealed.keyVersion,
          aadHex: sealed.aadHex,
          integritySha256: sealed.integritySha256,
        },
        KEY,
      ),
    ).toThrow(AppError);
  });

  it('rejects when the stored integrity hash does not match the object bytes', () => {
    const plain = Buffer.from('integrity check must fire');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    const modified = Buffer.from(sealed.blob);
    const i = modified.length - 2;
    modified.writeUInt8(modified.readUInt8(i) ^ 0x02, i);
    expect(() =>
      decryptGcm(
        modified,
        context(),
        {
          blob: modified,
          keyId: sealed.keyId,
          keyVersion: sealed.keyVersion,
          aadHex: sealed.aadHex,
          integritySha256: sealed.integritySha256,
        },
        KEY,
      ),
    ).toThrow(AppError);
  });

  it('rejects a wrong decryption key', () => {
    const plain = Buffer.from('key check');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    const wrongKey = Buffer.from('0'.repeat(32), 'utf8');
    expect(() =>
      decryptGcm(
        sealed.blob,
        context(),
        {
          blob: sealed.blob,
          keyId: sealed.keyId,
          keyVersion: sealed.keyVersion,
          aadHex: sealed.aadHex,
          integritySha256: sealed.integritySha256,
        },
        wrongKey,
      ),
    ).toThrow(AppError);
  });

  it('rejects a truncated ciphertext (missing auth tag)', () => {
    const plain = Buffer.from('truncated');
    const sealed = encryptGcm(plain, context(), KEY, 'documents', 1);
    const truncated = sealed.blob.subarray(0, sealed.blob.length - 20);
    expect(() =>
      decryptGcm(
        truncated,
        context(),
        {
          blob: truncated,
          keyId: sealed.keyId,
          keyVersion: sealed.keyVersion,
          aadHex: sealed.aadHex,
          integritySha256: sealed.integritySha256,
        },
        KEY,
      ),
    ).toThrow(AppError);
  });

  it('produces unique ciphertexts for repeated plaintext (fresh IV each time)', () => {
    const plain = Buffer.from('same payload');
    const a = encryptGcm(plain, context(), KEY, 'documents', 1);
    const b = encryptGcm(plain, context(), KEY, 'documents', 1);
    expect(a.blob.equals(b.blob)).toBe(false);
  });
});

describe('key manager (HKDF derivation)', () => {
  it('derives stable per-version keys that change across versions', async () => {
    const { ctx, cleanup } = await makeTestContext();
    try {
      const v1 = await ctx.keys.bumpVersion('documents');
      const v2 = await ctx.keys.bumpVersion('documents');
      expect(v1.keyId).toBe('documents');
      expect(v2.version).toBe(v1.version + 1);
      expect(v1.key).toHaveLength(32);
      expect(v1.key.equals(v2.key)).toBe(false);
      const v1Again = await ctx.keys.getKey('documents', v1.version);
      expect(v1Again.key.equals(v1.key)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('rejects invalid key versions', async () => {
    const { ctx, cleanup } = await makeTestContext();
    try {
      await expect(ctx.keys.getKey('documents', 0)).rejects.toThrow();
      await expect(ctx.keys.getKey('documents', -3)).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});