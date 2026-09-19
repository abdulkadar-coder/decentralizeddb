/**
 * Canonical Additional Authenticated Data (AAD) for GDPR-style document objects.
 *
 * The AAD cryptographically binds each AES-256-GCM ciphertext to its
 * application context: realm, storage bucket, opaque object key and content
 * type. If an object is replayed into a different bucket/key/type the
 * authentication tag fails to verify and decryption is rejected.
 */
export interface EncryptionContext {
  realm: string;
  bucket: string;
  objectKey: string;
  contentType: string;
}

export function buildAad(context: EncryptionContext): Buffer {
  const canonical = [
    'zerotrust-hrms/aad/v1',
    `realm=${context.realm}`,
    `bucket=${context.bucket}`,
    `object=${context.objectKey}`,
    `type=${context.contentType}`,
  ].join('\n');
  return Buffer.from(canonical, 'utf8');
}