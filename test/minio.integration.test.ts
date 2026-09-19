import { describe, it, expect } from 'vitest';
import { MinioStorageAdapter } from '../src/storage/minio-adapter.js';
import { StorageNotFoundError } from '../src/storage/types.js';

/**
 * Integration test for the real MinIO adapter. Requires a live MinIO server.
 *
 * Run it with:
 *   docker compose up -d minio          (starts the dev MinIO server)
 *   MINIO_TEST=1 npm test -- --run test/minio.integration.test.ts
 *
 * Skipped automatically when MINIO_TEST is unset so CI/dev without Docker
 * still passes.
 */
const enabled = process.env.MINIO_TEST === '1';
const endpoint = process.env.MINIO_TEST_ENDPOINT ?? 'localhost';
const port = Number(process.env.MINIO_TEST_PORT ?? 9000);
const bucket = process.env.MINIO_TEST_BUCKET ?? 'hrms-test-docs';

const describeMaybe = enabled ? describe : describe.skip;

describeMaybe('MinioStorageAdapter - real server integration', () => {
  async function makeAdapter(withInit = true): Promise<MinioStorageAdapter> {
    const adapter = new MinioStorageAdapter({
      endpoint,
      port,
      useSSL: false,
      accessKey: process.env.MINIO_TEST_ACCESS_KEY ?? 'hrms_dev_access',
      secretKey: process.env.MINIO_TEST_SECRET_KEY ?? 'hrms_dev_secret',
      bucket: `${bucket}-${process.pid}`,
    });
    if (withInit) await adapter.init();
    return adapter;
  }

  it('creates a private bucket, puts/stats/gets/removes objects and reports missing objects', async () => {
    const adapter = await makeAdapter();
    try {
      const key = `documents/opaque-${process.pid}`;
      await adapter.put(key, Buffer.from('ciphertext-bytes'), {
        metadata: { key_id: 'documents', integrity_sha256: 'f'.repeat(64) },
      });
      expect(await adapter.exists(key)).toBe(true);
      const stat = await adapter.stat(key);
      expect(stat.size).toBe(16);
      expect(stat.metadata.key_id).toBe('documents');
      const got = await adapter.get(key);
      expect(got.body.toString()).toBe('ciphertext-bytes');
      expect(got.metadata.integrity_sha256).toHaveLength(64);
      await adapter.remove(key);
      expect(await adapter.exists(key)).toBe(false);
      await expect(adapter.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
      await expect(adapter.ping()).resolves.toBeUndefined();
    } finally {
      await adapter.remove(`documents/opaque-${process.pid}`).catch(() => undefined);
    }
  });

  it('rejects path-traversal style opaque keys', async () => {
    const adapter = await makeAdapter();
    try {
      await expect(adapter.put('../escape', Buffer.from('x'))).rejects.toThrow();
      await expect(adapter.get('a/../../b')).rejects.toThrow();
    } finally {
      /* nothing to clean */
    }
  });

  it('fails construction without credentials', () => {
    expect(
      () =>
        new MinioStorageAdapter({
          endpoint,
          port,
          useSSL: false,
          accessKey: '',
          secretKey: '',
          bucket,
        }),
    ).toThrow();
  });
});