import { Client as MinioClient } from 'minio';
import { logger } from '../logger.js';
import {
  assertOpaqueKey,
  StorageNotFoundError,
  StorageUnavailableError,
  type StorageAdapter,
  type StoredObjectMetadata,
} from './types.js';

export interface MinioConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

const PRIVATE_POLICY = (bucket: string) => ({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Deny',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject', 's3:GetBucketLocation'],
      Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    },
  ],
});

function isNoSuchKey(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === 'NoSuchKey' || code === 'NotFound';
}

function isBucketDoesNotExist(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === 'NoSuchBucket';
}

/**
 * MinIO-backed object storage adapter.
 *
 * Guarantees:
 * - Objects are put/read/removed through the private bucket only.
 * - No presigned or anonymous URLs are ever generated.
 * - Only opaque object identifiers are accepted, never user-controlled
 *   content is used as the key.
 * - Credentials come exclusively from environment variables via `config`.
 * - Missing objects and storage failures are mapped to typed errors.
 */
export class MinioStorageAdapter implements StorageAdapter {
  readonly kind = 'minio';
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(private readonly cfg: MinioConfig) {
    if (!cfg.accessKey || !cfg.secretKey) {
      throw new StorageUnavailableError('MinIO credentials are not configured');
    }
    this.client = new MinioClient({
      endPoint: cfg.endpoint,
      port: cfg.port,
      useSSL: cfg.useSSL,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
    });
    this.bucket = cfg.bucket;
  }

  async init(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        logger.warn('storage.minio', 'creating bucket', { bucket: this.bucket });
        await this.client.makeBucket(this.bucket);
      }
      await this.client.setBucketPolicy(this.bucket, JSON.stringify(PRIVATE_POLICY(this.bucket)));
      logger.info('storage.minio', 'bucket ready with explicit private policy', { bucket: this.bucket });
    } catch (cause) {
      if (isBucketDoesNotExist(cause)) throw cause;
      throw new StorageUnavailableError(`cannot initialise MinIO bucket: ${String(cause)}`);
    }
  }

  async put(key: string, body: Buffer, options?: { metadata?: StoredObjectMetadata }): Promise<void> {
    assertOpaqueKey(key);
    try {
      const meta = options?.metadata ?? {};
      await this.client.putObject(this.bucket, key, body, body.length, { metaData: meta });
    } catch (cause) {
      throw new StorageUnavailableError(`MinIO put failed for ${key}: ${String(cause)}`);
    }
  }

  async get(key: string): Promise<{ body: Buffer; size: number; metadata: Record<string, string> }> {
    assertOpaqueKey(key);
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const info = await this.client.statObject(this.bucket, key);
      return { body, size: body.length, metadata: info.metaData ?? {} };
    } catch (cause) {
      if (isNoSuchKey(cause)) throw new StorageNotFoundError(key);
      throw new StorageUnavailableError(`MinIO get failed for ${key}: ${String(cause)}`);
    }
  }

  async stat(key: string): Promise<{ key: string; size: number; metadata: Record<string, string> }> {
    assertOpaqueKey(key);
    try {
      const info = await this.client.statObject(this.bucket, key);
      return { key, size: info.size, metadata: info.metaData ?? {} };
    } catch (cause) {
      if (isNoSuchKey(cause)) throw new StorageNotFoundError(key);
      throw new StorageUnavailableError(`MinIO stat failed for ${key}: ${String(cause)}`);
    }
  }

  async remove(key: string): Promise<void> {
    assertOpaqueKey(key);
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (cause) {
      if (isNoSuchKey(cause)) throw new StorageNotFoundError(key);
      throw new StorageUnavailableError(`MinIO remove failed for ${key}: ${String(cause)}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    assertOpaqueKey(key);
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch (cause) {
      if (isNoSuchKey(cause)) return false;
      throw new StorageUnavailableError(`MinIO exists failed for ${key}: ${String(cause)}`);
    }
  }

  async ping(): Promise<void> {
    try {
      await this.client.bucketExists(this.bucket);
    } catch (cause) {
      throw new StorageUnavailableError(`MinIO is unreachable: ${String(cause)}`);
    }
  }
}