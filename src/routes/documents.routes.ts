import { Router, raw } from 'express';
import type { AppContext } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { validateParam } from '../middleware/validate.js';
import { idSchema } from '../validation.js';
import { errors } from '../errors.js';

function toDocumentMeta(doc: {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: string;
  uploaded_at: string;
  revoked_at: string | null;
}) {
  return {
    id: doc.id,
    filename: doc.filename,
    contentType: doc.content_type,
    sizeBytes: doc.size_bytes,
    status: doc.status,
    uploadedAt: doc.uploaded_at,
    revokedAt: doc.revoked_at,
  };
}

export function documentRoutes(ctx: AppContext): Router {
  const router = Router();
  const auth = requireAuth(ctx.config.jwtSecret, (id) => ctx.auth.resolveForAuth(id));

  router.use(auth);

  router.post('/:employeeId/documents', validateParam(idSchema, 'employeeId'), raw({ type: '*/*', limit: '10mb' }), (req, res, next) => {
    const filename = req.header('x-filename');
    if (!filename || filename.length === 0 || filename.length > 255) {
      next(errors.badRequest('X-Filename header is required (up to 255 chars)'));
      return;
    }
    if (/[\\/\x00-\x1F]/.test(filename)) {
      next(errors.badRequest('Filename may not contain path separators or control characters'));
      return;
    }
    const contentType = req.header('content-type') ?? 'application/octet-stream';
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      next(errors.badRequest('Body must be raw bytes'));
      return;
    }
    ctx.documents
      .upload(req.auth!, { employeeId: req.params.employeeId!, filename, contentType, body })
      .then((doc) => {
        res.status(201).json({ document: toDocumentMeta(doc) });
      })
      .catch(next);
  });

  router.get('/:employeeId/documents', validateParam(idSchema, 'employeeId'), async (req, res, next) => {
    try {
      const docs = await ctx.documents.listDocumentMeta(req.auth!, req.params.employeeId!);
      res.status(200).json({ documents: docs.map(toDocumentMeta) });
    } catch (cause) {
      next(cause);
    }
  });

  router.get(
    '/:employeeId/documents/:documentId',
    validateParam(idSchema, 'employeeId'),
    validateParam(idSchema, 'documentId'),
    async (req, res, next) => {
      try {
        const result = await ctx.documents.download(
          req.auth!,
          req.params.employeeId!,
          req.params.documentId!,
        );
        res
          .status(200)
          .setHeader('Content-Type', result.contentType)
          .setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
          .setHeader('X-Document-Id', result.doc.id)
          .send(result.buffer);
      } catch (cause) {
        next(cause);
      }
    },
  );

  router.delete(
    '/:employeeId/documents/:documentId',
    validateParam(idSchema, 'employeeId'),
    validateParam(idSchema, 'documentId'),
    async (req, res, next) => {
      try {
        const doc = await ctx.documents.revoke(req.auth!, req.params.employeeId!, req.params.documentId!);
        res.status(200).json({ document: toDocumentMeta(doc), revoked: true });
      } catch (cause) {
        next(cause);
      }
    },
  );

  return router;
}