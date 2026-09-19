import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStorageAdapter } from '../src/storage/filesystem-adapter.js';
import { StorageNotFoundError, StorageUnavailableError } from '../src/storage/types.js';

function freshRoot(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'fs-store-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('FilesystemStorageAdapter - interface contract', () => {
  it('puts, stats and gets an object with metadata', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const adapter = new FilesystemStorageAdapter(dir);
      await adapter.put('documents/abc-123', Buffer.from('encrypted-bytes'), {
        metadata: { key_id: 'documents', key_version: '2', integrity_sha256: 'a'.repeat(64) },
      });
      expect(await adapter.exists('documents/abc-123')).toBe(true);
      const stat = await adapter.stat('documents/abc-123');
      expect(stat.size).toBe(15);
      expect(stat.metadata.key_id).toBe('documents');
      const got = await adapter.get('documents/abc-123');
      expect(got.body.toString()).toBe('encrypted-bytes');
      expect(got.size).toBe(15);
    } finally {
      cleanup();
    }
  });

  it('removes an object (blob and metadata)', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const adapter = new FilesystemStorageAdapter(dir);
      await adapter.put('documents/x', Buffer.from('data'));
      await adapter.remove('documents/x');
      expect(await adapter.exists('documents/x')).toBe(false);
      await expect(adapter.get('documents/x')).rejects.toBeInstanceOf(StorageNotFoundError);
    } finally {
      cleanup();
    }
  });

  it('rejects opaque-key traversal and forbidden characters', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const adapter = new FilesystemStorageAdapter(dir);
      for (const bad of ['../secrets', 'a/../../x', 'a/b c']) {
        await expect(adapter.put(bad, Buffer.from('x'))).rejects.toThrow();
      }
    } finally {
      cleanup();
    }
  });

  it('reports missing objects as StorageNotFoundError', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const adapter = new FilesystemStorageAdapter(dir);
      await expect(adapter.get('documents/missing')).rejects.toBeInstanceOf(StorageNotFoundError);
      await expect(adapter.stat('documents/missing')).rejects.toBeInstanceOf(StorageNotFoundError);
      await expect(adapter.remove('documents/missing')).rejects.toBeInstanceOf(StorageNotFoundError);
    } finally {
      cleanup();
    }
  });

  it('wraps storage failures in StorageUnavailableError', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'i am a file, not a directory');
      expect(() => new FilesystemStorageAdapter(blocker)).toThrow(StorageUnavailableError);
    } finally {
      cleanup();
    }
  });

  it('ping() passes when the root exists and fails otherwise', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const adapter = new FilesystemStorageAdapter(dir);
      await expect(adapter.ping()).resolves.toBeUndefined();
      rmSync(dir, { recursive: true, force: true });
      await expect(adapter.ping()).rejects.toBeInstanceOf(StorageUnavailableError);
    } finally {
      cleanup();
    }
  });

  it('persists objects across adapter instances (real write-through)', async () => {
    const { dir, cleanup } = freshRoot();
    try {
      const a = new FilesystemStorageAdapter(dir);
      await a.put('documents/persist', Buffer.from(Buffer.from([1, 2, 3])), {});
      const b = new FilesystemStorageAdapter(dir);
      const got = await b.get('documents/persist');
      expect(got.body).toEqual(Buffer.from([1, 2, 3]));
      mkdirSync(join(dir, 'nested', 'deep'), { recursive: true });
    } finally {
      cleanup();
    }
  });
});