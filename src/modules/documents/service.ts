import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { nowIso } from '../../db/index.js';
import { errors, AppError } from '../../errors.js';
import type { AppConfig } from '../../config.js';
import type { StorageAdapter } from '../../storage/types.js';
import { StorageNotFoundError } from '../../storage/types.js';
import type { KeyManager } from '../../crypto/keys.js';
import type { EncryptionContext } from '../../crypto/aad.js';
import { encryptGcm, decryptGcm } from '../../crypto/encryption.js';
import type { Actor } from '../../authorization.js';
import { canAccessDocument, canManageEmployee } from '../../authorization.js';
import type { AuditService } from '../audit/service.js';
import { masked } from '../audit/format.js';

export interface DocumentRow {
  id: string;
  employee_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  key_id: string;
  key_version: number;
  aad_hex: string;
  integrity_sha256: string;
  status: 'ACTIVE' | 'REVOKED';
  uploaded_by: string | null;
  uploaded_at: string;
  revoked_at: string | null;
}

export interface UploadInput {
  employeeId: string;
  filename: string;
  contentType: string;
  body: Buffer;
}

const MAX_BYTES = 10 * 1024 * 1024;

export class DocumentsService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly storage: StorageAdapter,
    private readonly keys: KeyManager,
    private readonly audit: AuditService,
  ) {}

  private getDoc(id: string): DocumentRow {
    const row = this.db
      .prepare(
        `SELECT id, employee_id, filename, content_type, size_bytes, object_key, key_id, key_version, aad_hex,
                integrity_sha256, status, uploaded_by, uploaded_at, revoked_at
         FROM documents WHERE id = ?`,
      )
      .get(id) as DocumentRow | undefined;
    if (!row) throw errors.notFound('Document not found');
    return row;
  }

  private getEmployee(employeeId: string): { id: string; user_id: string | null; managed_by: string | null } {
    const row = this.db
      .prepare('SELECT id, user_id, managed_by FROM employees WHERE id = ?')
      .get(employeeId) as { id: string; user_id: string | null; managed_by: string | null } | undefined;
    if (!row) throw errors.notFound('Employee not found');
    return row;
  }

  private storageContext(objectKey: string, contentType: string): EncryptionContext {
    return {
      realm: 'employees',
      bucket: this.config.storageBackend === 'minio' ? this.config.minio.bucket : this.config.storageBackend,
      objectKey,
      contentType,
    };
  }

  async listDocumentMeta(actor: Actor, employeeId: string): Promise<DocumentRow[]> {
    const employee = this.getEmployee(employeeId);
    if (!canAccessDocument(actor, employee, { employee_id: employeeId })) {
      throw errors.forbidden('Access to this employee\'s documents is not allowed');
    }
    const rows = this.db
      .prepare(
        `SELECT id, employee_id, filename, content_type, size_bytes, object_key, key_id, key_version, aad_hex,
                integrity_sha256, status, uploaded_by, uploaded_at, revoked_at
         FROM documents WHERE employee_id = ? ORDER BY uploaded_at ASC`,
      )
      .all(employeeId) as unknown as DocumentRow[];
    return rows;
  }

  async upload(actor: Actor, input: UploadInput): Promise<DocumentRow> {
    const employee = this.getEmployee(input.employeeId);
    if (!canManageEmployee(actor, employee)) {
      throw errors.forbidden('You may not upload documents for this employee');
    }
    if (input.body.length === 0) throw errors.badRequest('Empty documents are not allowed');
    if (input.body.length > MAX_BYTES) throw errors.payloadTooLarge('Document exceeds 10 MB limit');

    const objectKey = `documents/${randomUUID()}`;
    const managed = await this.keys.bumpVersion('documents');
    const context = this.storageContext(objectKey, input.contentType);
    const sealed = encryptGcm(input.body, context, managed.key, managed.keyId, managed.version);

    try {
      await this.storage.put(objectKey, sealed.blob, {
        metadata: {
          key_id: sealed.keyId,
          key_version: String(sealed.keyVersion),
          integrity_sha256: sealed.integritySha256,
          content_type: input.contentType,
          status: 'ACTIVE',
        },
      });
    } catch (cause) {
      throw errors.storage(`Object storage failed during upload: ${String(cause)}`);
    }

    const id = randomUUID();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO documents (id, employee_id, filename, content_type, size_bytes, object_key, key_id, key_version,
           aad_hex, integrity_sha256, status, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(
        id,
        input.employeeId,
        input.filename,
        input.contentType,
        input.body.length,
        objectKey,
        sealed.keyId,
        sealed.keyVersion,
        sealed.aadHex,
        sealed.integritySha256,
        actor.userId,
        ts,
      );

    await this.audit.record('DOCUMENT_UPLOADED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: input.employeeId,
      payload: {
        documentId: id,
        filename: input.filename,
        bytes: input.body.length,
        integritySha256: masked(sealed.integritySha256),
      },
    });
    return this.getDoc(id);
  }

  async download(actor: Actor, employeeId: string, documentId: string): Promise<{
    buffer: Buffer;
    filename: string;
    contentType: string;
    doc: DocumentRow;
  }> {
    const employee = this.getEmployee(employeeId);
    const doc = this.getDoc(documentId);
    if (doc.employee_id !== employeeId) throw errors.notFound('Document not found for this employee');
    if (!canAccessDocument(actor, employee, doc)) throw errors.forbidden('Access denied to this document');

    let blob: Buffer;
    try {
      const fetched = await this.storage.get(doc.object_key);
      blob = fetched.body;
      const md = fetched.metadata;
      if ((md.key_id && md.key_id !== doc.key_id) || md.integrity_sha256 && md.integrity_sha256 !== doc.integrity_sha256) {
        throw errors.crypto('object metadata does not match the document record');
      }
    } catch (cause) {
      if (cause instanceof StorageNotFoundError) {
        throw errors.notFound('Document content is missing from object storage');
      }
      if (cause instanceof AppError) {
        throw cause;
      }
      throw errors.storage(`Object storage failed during download: ${String(cause)}`);
    }

    const key = await this.keys.getKey(doc.key_id, doc.key_version);
    const context = this.storageContext(doc.object_key, doc.content_type);
    const plaintext = decryptGcm(
      blob,
      context,
      { blob, keyId: doc.key_id, keyVersion: doc.key_version, aadHex: doc.aad_hex, integritySha256: doc.integrity_sha256 },
      key.key,
    );

    await this.audit.record('DOCUMENT_ACCESSED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: employeeId,
      payload: { documentId: doc.id, filename: doc.filename, bytes: plaintext.length },
    });

    return { buffer: plaintext, filename: doc.filename, contentType: doc.content_type, doc };
  }

  /** Revoke access and securely purge the ciphertext from storage. */
  async revoke(actor: Actor, employeeId: string, documentId: string): Promise<DocumentRow> {
    const employee = this.getEmployee(employeeId);
    const doc = this.getDoc(documentId);
    if (doc.employee_id !== employeeId) throw errors.notFound('Document not found for this employee');
    const isOwner = doc.employee_id === (actor.employeeId ?? '') && employee.user_id === actor.userId;
    if (actor.role !== 'ADMIN' && !isOwner && !canManageEmployee(actor, employee)) {
      throw errors.forbidden('You may not revoke access to this document');
    }

    try {
      await this.storage.remove(doc.object_key);
    } catch (cause) {
      if (!(cause instanceof StorageNotFoundError)) {
        throw errors.storage(`Object storage failed during revoke: ${String(cause)}`);
      }
    }

    const ts = nowIso();
    this.db
      .prepare('UPDATE documents SET status = ?, revoked_at = ? WHERE id = ?')
      .run('REVOKED', ts, doc.id);

    await this.audit.record('ACCESS_REVOKED', {
      actorId: actor.userId,
      actorRole: actor.role,
      subjectId: employeeId,
      payload: { documentId: doc.id, filename: doc.filename },
    });
    return this.getDoc(documentId);
  }
}