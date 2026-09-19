import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { FilesystemStorageAdapter } from './filesystem-adapter.js';
import { MinioStorageAdapter } from './minio-adapter.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter } from './types.js';

export function createStorageAdapter(config: AppConfig): StorageAdapter {
  if (config.storageBackend === 'minio') {
    const adapter = new MinioStorageAdapter(config.minio);
    void adapter.init().catch((cause) => {
      // Surface readiness on ping/health; do not fail process boot so the
      // rest of the API remains available and reports storage health.
      // Logged without any credentials.
      logger.warn('storage.minio', `init deferred: ${String(cause)}`);
    });
    return adapter;
  }
  if (config.storageBackend === 'filesystem') {
    return new FilesystemStorageAdapter(config.fsStorageRoot);
  }
  throw new Error(`unknown STORAGE_BACKEND: ${config.storageBackend}`);
}