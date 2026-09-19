export interface StoredObjectMetadata {
  [key: string]: string;
}

export interface StoredObject {
  key: string;
  size: number;
  metadata: StoredObjectMetadata;
}

export interface StoragePutOptions {
  metadata?: StoredObjectMetadata;
}

export interface StorageAdapter {
  readonly kind: string;
  put(key: string, body: Buffer, options?: StoragePutOptions): Promise<void>;
  get(key: string): Promise<{ body: Buffer; size: number; metadata: StoredObjectMetadata }>;
  stat(key: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  ping(): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/** Opaque object keys must never leak content. UUIDs satisfy this. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,254}$/;

export function assertOpaqueKey(key: string): void {
  if (!key || !KEY_PATTERN.test(key) || key.includes('..')) {
    throw new Error(`invalid object key: ${JSON.stringify(key)}`);
  }
}