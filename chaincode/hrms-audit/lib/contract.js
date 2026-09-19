/*
 * hrms-audit chaincode
 *
 * Append-only audit ledger for HRMS events. Security posture:
 *  - No update or delete transactions exist; ledger is append-only by design.
 *  - Every record records the transaction's cryptographic endorsement context:
 *    the submitting organization (MSP), the X509 enrollment id when present,
 *    and the Fabric transaction id + peer commit timestamp (not caller time).
 *  - Caller-supplied payload is limited in size and shape; sensitive documents
 *    and encryption keys must NEVER be written on-chain (they live encrypted
 *    in object storage). Only non-sensitive audit metadata belongs here.
 *  - Chaincode rejects submissions from MSPs outside the four authorized orgs.
 *  - Each record is hash-chained to the previous one (in-contract hash chain)
 *    as defense-in-depth on top of the ordering service's own block hashing.
 */
'use strict';

const crypto = require('node:crypto');
const { Contract } = require('fabric-contract-api');

const ALLOWED_EVENT_TYPES = Object.freeze([
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'ROLE_CHANGED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_ACCESSED',
  'ACCESS_REVOKED',
]);

const ALLOWED_MSP = Object.freeze([
  'HROrgMSP',
  'ITOrgMSP',
  'FinanceOrgMSP',
  'AdminOrgMSP',
]);

const MAX_PAYLOAD_BYTES = 4096;
const MAX_PAYLOAD_KEYS = 12;
const MAX_ID_LENGTH = 128;
const RANGE_LIMIT = 500;
const SEQ_KEY = 'meta:seq';
const PREFIX = 'audit:';
const SUBJECT_PREFIX = 'audit:subject:';
const TYPE_PREFIX = 'audit:type:';

function toBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Canonical serialization: sorted keys so hash chaining is deterministic.
function canonicalString(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = walk(v[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function isValidId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_.:@+-]+$/.test(value)
  );
}

class HRMSAuditContract extends Contract {
  constructor() {
    super('hrmsaudit');
  }

  _assertAuthorizedCreator(ctx) {
    const msp = ctx.clientIdentity.getMSPID();
    if (!ALLOWED_MSP.includes(msp)) {
      throw new Error(
        `forbidden: submission from MSP '${msp}' is not an authorized organization`,
      );
    }
  }

  _validateEventType(type) {
    if (!ALLOWED_EVENT_TYPES.includes(type)) {
      throw new Error(
        `invalid eventType '${type}'; allowed: ${ALLOWED_EVENT_TYPES.join(', ')}`,
      );
    }
  }

  _validatePayload(payloadJson) {
    let payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      throw new Error('payload must be a valid JSON string');
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be a JSON object');
    }
    if (Object.keys(payload).length > MAX_PAYLOAD_KEYS) {
      throw new Error(`payload exceeds ${MAX_PAYLOAD_KEYS} keys`);
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new Error(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean' && v !== null) {
        throw new Error(`payload values must be scalar; key '${k}' is not`);
      }
    }
    return payload;
  }

  async _readSeq(ctx) {
    const buf = await ctx.stub.getState(SEQ_KEY);
    if (!buf || buf.length === 0) return 0;
    const n = Number(Buffer.from(buf).toString('utf8'));
    if (!Number.isInteger(n) || n < 0) throw new Error('corrupt sequence counter');
    return n;
  }

  async _readRecord(ctx, seq) {
    const buf = await ctx.stub.getState(`${PREFIX}${seq}`);
    if (!buf || buf.length === 0) return null;
    return JSON.parse(Buffer.from(buf).toString('utf8'));
  }

  async _chainHash(ctx, newSeq) {
    if (newSeq === 1) return '0'.repeat(64);
    const prev = await this._readRecord(ctx, newSeq - 1);
    if (!prev) throw new Error('previous record missing; cannot chain');
    return sha256Hex(canonicalString(prev));
  }

  /**
   * Append a validated audit record. Returns the stored record.
   * @param {Context} ctx
   * @param {string} eventType one of ALLOWED_EVENT_TYPES
   * @param {string} actorId business actor id (e.g. backend user id)
   * @param {string} subjectId subject (employee id, document id, etc.)
   * @param {string} payloadJson non-sensitive metadata (JSON object)
   */
  async submitAudit(ctx, eventType, actorId, subjectId, payloadJson) {
    this._assertAuthorizedCreator(ctx);
    this._validateEventType(eventType);
    if (!isValidId(actorId)) throw new Error('invalid actorId');
    if (!isValidId(subjectId)) throw new Error('invalid subjectId');
    const payload = this._validatePayload(payloadJson);

    const seq = await this._readSeq(ctx) + 1;
    const ts = ctx.stub.getTxTimestamp();
    const record = {
      seq,
      eventType,
      actorId,
      subjectId,
      payload,
      creatorMsp: ctx.clientIdentity.getMSPID(),
      signerId: ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || 'unknown',
      ts: new Date(
        Number(ts.seconds || ts.secondsLow || 0) * 1000 + Math.floor(Number(ts.nanos || 0) / 1e6),
      ).toISOString(),
      txId: ctx.stub.getTxID(),
      prevHash: await this._chainHash(ctx, seq),
    };
    record.hash = sha256Hex(canonicalString({ ...record, hash: undefined }));

    await ctx.stub.putState(SEQ_KEY, toBytes(seq));
    await ctx.stub.putState(`${PREFIX}${seq}`, toBytes(record));
    await ctx.stub.putState(`${SUBJECT_PREFIX}${subjectId}:${seq}`, toBytes({ seq }));
    await ctx.stub.putState(`${TYPE_PREFIX}${eventType}:${seq}`, toBytes({ seq }));

    return record;
  }

async querySeq(ctx) {
    return { seq: await this._readSeq(ctx) };
  }

async queryAll(ctx, startSeq = 1, endSeq = null) {
    let from = Number(startSeq || 1);
    let to = endSeq === undefined || endSeq === '' || endSeq === null ? null : Number(endSeq);
    if (!Number.isInteger(from) || from < 1) throw new Error('invalid startSeq');
    const limit = to === null ? RANGE_LIMIT : to - from + 1;
    if (limit < 1) throw new Error('endSeq must be >= startSeq');
    if (limit > RANGE_LIMIT) throw new Error(`range too large (max ${RANGE_LIMIT})`);

    const records = [];
    let cursor = from;
    while (cursor <= (to ?? from + limit - 1) && records.length < limit) {
      const rec = await this._readRecord(ctx, cursor);
      if (rec) records.push(rec);
      cursor += 1;
    }
    return records;
  }

async queryBySubject(ctx, subjectId) {
    if (!isValidId(subjectId)) throw new Error('invalid subjectId');
    const records = [];
    const startKey = `${SUBJECT_PREFIX}${subjectId}:0`;
    const endKey = `${SUBJECT_PREFIX}${subjectId}:\uffff`;
    for await (const res of ctx.stub.getStateByRange(startKey, endKey)) {
      const idx = JSON.parse(Buffer.from(res.value).toString('utf8'));
      const rec = await this._readRecord(ctx, idx.seq);
      if (rec) {
        records.push(rec);
        if (records.length >= RANGE_LIMIT) break;
      }
    }
    return records;
  }

  async queryByType(ctx, eventType) {
    this._validateEventType(eventType);
    const records = [];
    const startKey = `${TYPE_PREFIX}${eventType}:0`;
    const endKey = `${TYPE_PREFIX}${eventType}:\uffff`;
    for await (const res of ctx.stub.getStateByRange(startKey, endKey)) {
      const idx = JSON.parse(Buffer.from(res.value).toString('utf8'));
      const rec = await this._readRecord(ctx, idx.seq);
      if (rec) {
        records.push(rec);
        if (records.length >= RANGE_LIMIT) break;
      }
    }
    return records;
  }

async verifyChain(ctx) {
    const seq = await this._readSeq(ctx);
    const broken = [];
    for (let i = 1; i <= seq; i += 1) {
      const rec = await this._readRecord(ctx, i);
      if (!rec) {
        broken.push({ seq: i, reason: 'missing' });
        continue;
      }
      if (i === 1 && rec.prevHash !== '0'.repeat(64)) {
        broken.push({ seq: i, reason: 'genesis hash mismatch' });
        continue;
      }
      if (i > 1) {
        const prev = await this._readRecord(ctx, i - 1);
        const expect = sha256Hex(canonicalString(prev));
        if (rec.prevHash !== expect) {
          broken.push({ seq: i, reason: 'prevHash mismatch' });
        }
      }
    }
    return { seq, intact: broken.length === 0, issues: broken };
  }
}

module.exports = { HRMSAuditContract, ALLOWED_EVENT_TYPES, ALLOWED_MSP, canonicalString, sha256Hex };
