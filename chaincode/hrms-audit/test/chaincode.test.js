/*
 * Unit tests for hrms-audit chaincode (run via `node --test`).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { HRMSAuditContract, ALLOWED_EVENT_TYPES, canonicalString, sha256Hex } = require('../lib/contract');
const { MockContext } = require('./mock-context');

const contract = new HRMSAuditContract();

function freshCtx(options) {
  return new MockContext({ msp: 'HROrgMSP', ...options });
}

function validArgs(overrides = {}) {
  return [
    overrides.type ?? 'DOCUMENT_ACCESSED',
    overrides.actor ?? 'user-1234',
    overrides.subject ?? 'emp-0050',
    overrides.payload ?? JSON.stringify({ docId: 'doc-9f8e', ok: true }),
  ];
}

async function submitOne(ctx, args) {
  return contract.submitAudit(ctx, ...args);
}

test('ALLOWED_EVENT_TYPES covers required event vocabulary', () => {
  for (const t of ['EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'ROLE_CHANGED', 'DOCUMENT_UPLOADED', 'DOCUMENT_ACCESSED', 'ACCESS_REVOKED']) {
    assert.ok(ALLOWED_EVENT_TYPES.includes(t));
  }
});

test('submitAudit appends a fully-populated record and increments seq', async () => {
  const ctx = freshCtx();
  ctx.stub.setTxTimestamp(1_700_000_000, 250_000_000);
  const rec = await submitOne(ctx, validArgs());
  assert.equal(rec.seq, 1);
  assert.equal(rec.eventType, 'DOCUMENT_ACCESSED');
  assert.equal(rec.actorId, 'user-1234');
  assert.equal(rec.subjectId, 'emp-0050');
  assert.deepEqual(rec.payload, { docId: 'doc-9f8e', ok: true });
  assert.equal(rec.creatorMsp, 'HROrgMSP');
  assert.equal(rec.ts, new Date(1_700_000_000_250).toISOString());
  assert.equal(rec.txId, ctx.stub.getTxID());
  assert.equal(rec.prevHash, '0'.repeat(64));
  assert.match(rec.hash, /^[0-9a-f]{64}$/);

  const rec2 = await submitOne(ctx, validArgs({ type: 'EMPLOYEE_CREATED', subject: 'emp-0100' }));
  assert.equal(rec2.seq, 2);
  assert.equal(rec2.prevHash, sha256Hex(canonicalString(rec)));
  assert.equal((await contract.querySeq(ctx)).seq, 2);
});

test('timestamp comes from the peer transaction timestamp, not the caller', async () => {
  const ctx1 = freshCtx();
  ctx1.stub.setTxTimestamp(1_800_000_000, 0);
  await submitOne(ctx1, validArgs({ actor: 'a1' }));

  const ctx2 = freshCtx({ msp: 'ITOrgMSP' });
  ctx2.stub.setTxTimestamp(1_900_000_000, 0);
  const rec = await submitOne(ctx2, validArgs({ actor: 'a2' }));
  assert.equal(rec.ts, new Date(1_900_000_000_000).toISOString());
  assert.equal(rec.creatorMsp, 'ITOrgMSP');
});

test('hash chain: verifyChain is intact after valid appends, broken after tamper', async () => {
  const ctx = freshCtx();
  for (let i = 0; i < 5; i += 1) {
    await submitOne(ctx, validArgs({ actor: `u${i}`, subject: `emp-${i}` }));
  }
  assert.deepEqual(await contract.verifyChain(ctx), { seq: 5, intact: true, issues: [] });

  // Simulate an attacker rewriting record 3 (does not touch record 4's prevHash).
  const buf = ctx.stub.state.get('audit:3');
  const rec = JSON.parse(Buffer.from(buf).toString('utf8'));
  rec.payload = { evil: 'injected' };
  ctx.stub.state.set('audit:3', Buffer.from(JSON.stringify(rec)));

  const check = await contract.verifyChain(ctx);
  assert.equal(check.intact, false);
  assert.deepEqual(check.issues, [{ seq: 4, reason: 'prevHash mismatch' }]);
});

test('rejects submission from a non-authorized organization', async () => {
  const ctx = freshCtx({ msp: 'OrdererMSP' });
  await assert.rejects(submitOne(ctx, validArgs()), /forbidden.*OrdererMSP/);
});

test('rejects unknown event types', async () => {
  const ctx = freshCtx();
  await assert.rejects(submitOne(ctx, validArgs({ type: 'PAYROLL_LEAK' })), /invalid eventType/);
});

test('rejects malformed ids', async () => {
  const ctx = freshCtx();
  await assert.rejects(submitOne(ctx, validArgs({ actor: 'x y z' })), /invalid actorId/);
  await assert.rejects(submitOne(ctx, validArgs({ subject: '' })), /invalid subjectId/);
  await assert.rejects(submitOne(ctx, validArgs({ subject: 'q'.repeat(200) })), /invalid subjectId/);
});

test('rejects non-JSON, non-object, excessive or non-scalar payloads', async () => {
  const ctx = freshCtx();
  await assert.rejects(submitOne(ctx, validArgs({ payload: 'not-json' })), /valid JSON/);
  await assert.rejects(submitOne(ctx, validArgs({ payload: '"just a string"' })), /JSON object/);
  await assert.rejects(submitOne(ctx, validArgs({ payload: JSON.stringify({ nested: { a: 1 } }) })), /must be scalar/);
  await assert.rejects(
    submitOne(ctx, validArgs({ payload: JSON.stringify({ pad: 'x'.repeat(5000) }) })),
    /exceeds \d+ bytes/,
  );
});

test('query functions return ordered, filtered history', async () => {
  const ctx = freshCtx();
  await submitOne(ctx, validArgs({ type: 'EMPLOYEE_CREATED', actor: 'u1', subject: 'emp-01' }));
  await submitOne(ctx, validArgs({ type: 'DOCUMENT_ACCESSED', actor: 'u2', subject: 'emp-01' }));
  await submitOne(ctx, validArgs({ type: 'ACCESS_REVOKED', actor: 'u3', subject: 'doc-x' }));

  const all = await contract.queryAll(ctx, '1', '10');
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((r) => r.seq), [1, 2, 3]);

  const bySubject = await contract.queryBySubject(ctx, 'emp-01');
  assert.deepEqual(bySubject.map((r) => r.eventType), ['EMPLOYEE_CREATED', 'DOCUMENT_ACCESSED']);

  const byType = await contract.queryByType(ctx, 'ACCESS_REVOKED');
  assert.equal(byType.length, 1);
  assert.equal(byType[0].subjectId, 'doc-x');
});

test('queryAll enforces range limits', async () => {
  const ctx = freshCtx();
  for (let i = 0; i < 40; i += 1) {
    await submitOne(ctx, validArgs({ actor: `u${i}`, subject: `emp-${i}` }));
  }
  await assert.rejects(contract.queryAll(ctx, '1', '999999'), /range too large/);
});

test('chain is append-only: contract exposes no update or delete transactions', () => {
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(contract))
    .filter((m) => !['constructor'].includes(m));
  for (const m of methods) {
    assert.ok(!/^(update|delete|del|modify|edit)/i.test(m), `forbidden mutable txn '${m}'`);
  }
});

test('canonicalString is deterministic regardless of key insertion order', () => {
  const a = canonicalString({ b: 1, a: { z: 'x', y: [1, 2] } });
  const b = canonicalString({ a: { y: [1, 2], z: 'x' }, b: 1 });
  assert.equal(a, b);
});