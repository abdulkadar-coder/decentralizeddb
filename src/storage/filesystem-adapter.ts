import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertOpaqueKey,
  StorageNotFoundError,
  StorageUnavailableError,
  type StorageAdapter,
  type StoredObject,
} from './types.js';

/**
 * Local filesystem storage adapter used for development and CI environments
 * that do not run MinIO. It provides the same interface and safety
 * guarantees (opaque keys only, no public access, missing-object and
 * failure handling). Objects are still stored *encrypted by the
 * encryption service upstream*; this adapter never touches plaintext.
 */
export class FilesystemStorageAdapter implements StorageAdapter {
  readonly kind = 'filesystem';

  constructor(private readonly root: string) {
    try {
      mkdirSync(root, { recursive: true });
    } catch (cause) {
      throw new StorageUnavailableError(`cannot initialise filesystem storage at ${root}: ${String(cause)}`);
    }
  }

  private blobPath(key: string): string {
    assertOpaqueKey(key);
    return join(this.root, key);
  }

  private metaPath(key: string): string {
    return `${this.blobPath(key)}.meta.json`;
  }

  async put(key: string, body: Buffer, options?: { metadata?: Record<string, string> }): Promise<void> {
    const blobPath = this.blobPath(key);
    try {
      mkdirSync(join(this.root, key.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(blobPath, body);
      const meta = { ...(options?.metadata ?? {}), size: String(body.length) };
      writeFileSync(this.metaPath(key), JSON.stringify(meta));
    } catch (cause) {
      throw new StorageUnavailableError(`filesystem storage write failed for ${key}: ${String(cause)}`);
    }
  }

  async get(key: string): Promise<{ body: Buffer; size: number; metadata: Record<string, string> }> {
    const blobPath = this.blobPath(key);
    if (!existsSync(blobPath)) throw new StorageNotFoundError(key);
    try {
      const body = readFileSync(blobPath);
      let metadata: Record<string, string> = {};
      if (existsSync(this.metaPath(key))) {
        metadata = JSON.parse(readFileSync(this.metaPath(key), 'utf8')) as Record<string, string>;
      }
      return { body, size: body.length, metadata };
    } catch (cause) {
      if (cause instanceof StorageNotFoundError) throw cause;
      throw new StorageUnavailableError(`filesystem storage read failed for ${key}: ${String(cause)}`);
    }
  }

  async stat(key: string): Promise<StoredObject> {
    const blobPath = this.blobPath(key);
    if (!existsSync(blobPath)) throw new StorageNotFoundError(key);
    const st = statSync(blobPath);
    let metadata: Record<string, string> = {};
    if (existsSync(this.metaPath(key))) {
      try {
        metadata = JSON.parse(readFileSync(this.metaPath(key), 'utf8')) as Record<string, string>;
      } catch {
        metadata = {};
      }
    }
    return { key, size: st.size, metadata };
  }

  async remove(key: string): Promise<void> {
    const blobPath = this.blobPath(key);
    if (!existsSync(blobPath)) throw new StorageNotFoundError(key);
    try {
      rmSync(blobPath, { force: true });
      if (existsSync(this.metaPath(key))) rmSync(this.metaPath(key), { force: true });
    } catch (cause) {
      throw new StorageUnavailableError(`filesystem storage delete failed for ${key}: ${String(cause)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.blobPath(key));
  }

  async ping(): Promise<void> {
    try {
      statSync(this.root);
    } catch (cause) {
      throw new StorageUnavailableError(`filesystem storage unavailable: ${String(cause)}`);
    }
  }
}