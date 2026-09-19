# Phase 1 Report — Secure Backend Foundation and Storage

Decentralized Zero-Trust Employee Data Management System — Phase 1 completion record.
All statements below reflect **actual runs** in this workspace on 2026-09-18.

## 1. Repository audit

The workspace at `C:\Users\syeda\OneDrive\Desktop\blockchain` was **empty** on start
(verified: 0 entries). No existing code was available to preserve or rewrite, so Phase 1
was implemented from scratch. Toolchain verified before work: Node.js **v24.20.0**,
npm **11.19.0**; built-in `node:sqlite` confirmed working; **Go and Docker are not
installed** on this machine.

Initial state: no tests existed (nothing to run) — see "Commands executed" for the
baseline. Implementation gaps at audit time were simply "everything"; the section below
records what Phase 1 now delivers and its remaining gaps.

## 2. Work delivered

| Area | Delivered |
| --- | --- |
| Backend | Node.js 24 + TypeScript (strict) + Express 4, ESM |
| Database | SQLite via built-in `node:sqlite` (WAL, FK enforcement, migration schema) |
| Auth | scrypt password hashing (per-user salt, `timingSafeEqual`), HS256 JWT (hand-built on `node:crypto`, constant-time verify, expiry checks) |
| RBAC | ADMIN / MANAGER / EMPLOYEE; fresh-identity DB re-resolution per request; employee ownership + manager-report scoping |
| Encryption | AES-256-GCM (random 12-byte IV, 128-bit auth tag), AAD context binding (realm/bucket/objectKey/contentType), SHA-256 integrity hash, envelope = `IV‖ct‖tag` |
| Key mgmt | `KeyManager` interface; HKDF-SHA256-derived, versioned keys from a master secret (persisted version registry, deterministic re-derivation) |
| Storage | `StorageAdapter` interface; `MinioStorageAdapter` (real SDK, explicitly private bucket, no presigned URLs, opaque keys, typed errors) + `FilesystemStorageAdapter` (dev/CI, ciphertext-only) |
| Blockchain | Single-node hash-linked audit chain: `{height, tx, timestamp, prevHash, hash}`; canonical SHA-256; genesis; pure `validateChain` tamper detection; SQLite + in-memory stores |
| API | /auth, /employees, /employees/:id/documents, /audit, /health endpoints; zod validation; 10 MB upload cap |
| Tests | 57 tests (Vitest + Supertest), 54 running here + 3 MinIO integration tests (skipped w/o live server) |
| Ops | ESLint flat config, `tsc --noEmit`, `.env.example`, Dockerfile, docker-compose (MinIO + app + healthchecks) |

### Security properties verified by tests
- AES-GCM: round-trip, tampered-ciphertext rejection, wrong-AAD rejection, integrity-hash
  rejection, wrong-key rejection, truncated-envelope rejection, fresh IV uniqueness.
- Keys: stable per-version HKDF derivation, version bumping, invalid-version rejection.
- Auth: duplicate usernames, weak passwords, bad login, forged/expired/wrong-secret JWTs.
- Access: employee read ownership (self/manager/admin), role-scoped lists, unauthorized
  document upload/download/revoke denied (403), wrong employee↔document pairing → 404,
  no-token → 401, role-change restricted to ADMIN.
- Storage pipeline: plaintext never present in object storage; missing object → 404;
  tampered ciphertext at rest → 500 `ENCRYPTION_FAILURE`.
- Blockchain: genesis, linking, deterministic hashing, tampered-tx, modified-hash, and
  broken-link detection; SQLite persistence.
- Health: DB + storage status.

## 3. Remaining limitations (honest)

1. **Blockchain is a local single-node prototype**, not a decentralized network (no
   consensus / p2p / distributed ledger). Labeled as such in code, README, and responses.
2. **`LocalKeyManager` is not a production KMS**: it derives keys from a master secret
   via HKDF. Real → authentic AES-256-GCM + key management, but production should swap in
   a KMS-backed `KeyManager` (interface already defined). No hardcoded production secrets;
   missing `JWT_SECRET`/`MASTER_KEY` in dev generates random per-boot values with a warning.
3. **MinIO integration tests** require a live MinIO server (`MINIO_TEST=1`); they skip
   otherwise. The Docker stack (`docker compose up --build`) provides it — not run here
   because Docker is not installed on this machine. The filesystem backend was used for
   all local verification; the MinIO adapter is real (official SDK) and covered by
   interface-contract tests plus gated integration tests.
4. **npm audit**: 6 moderate advisories, all in the `minio` SDK's transitive deps
   (`query-string`/`stream-json`/`decode-uri-component`). Only reachable via
   admin-configured storage settings (no unauthenticated input path); no non-breaking fix
   (`npm audit fix --force` downgrades to `minio@7`). Tracked for Phase 2.
5. No MFA / refresh-token rotation / external identity federation yet (out of Phase 1 scope).

## 4. Modified / created files

```
.eslintrc in eslint.config.mjs, tsconfig.json, vitest.config.ts
package.json, package-lock.json
.env (dev-only), .env.example, .gitignore, .dockerignore
README.md, docs/PHASE1_REPORT.md
Dockerfile, docker-compose.yml
src/config.ts, logger.ts, errors.ts, context.ts, app.ts, index.ts, validation.ts, authorization.ts
src/db/index.ts
src/crypto/{aad,integrity,keys,encryption}.ts
src/storage/{types,filesystem-adapter,minio-adapter,factory}.ts
src/blockchain/blockchain.ts
src/middleware/{auth,validate}.ts
src/modules/auth/{service,passwords,tokens}.ts
src/modules/audit/{service,format}.ts
src/modules/employees/service.ts
src/modules/documents/service.ts
src/routes/{auth,employees,documents,audit,health}.routes.ts
test/{helpers,crypto,blockchain,storage,passwords-tokens,api,minio.integration}.test.ts
scripts/demo.ts
```

## 5. Commands executed (actual results)

| Command | Result |
| --- | --- |
| `node --version` / `npm --version` | v24.20.0 / 11.19.0 |
| `npm install` | 296 packages installed |
| `npm run typecheck` | pass (strict) |
| `npm run lint` | 0 errors |
| `npm test` | **54 passed**, 3 skipped (MinIO integration) — 5 files passed, 1 skipped |
| `npm run check` | typecheck + lint + tests all pass |
| `npm run build` | `dist/src/index.js` emitted |
| `npm start` (then `GET /api/health`) | HTTP 200 `{"status":"ok","db":"ok","storage":"filesystem",...}` |
| `npm run demo` | full flow succeeded (see below) |

> The single `ERROR [http]` log line during tests is the *expected* 500 produced by the
> deliberate tampered-ciphertext test (integrity failure), not a test failure.

## 6. Demo verification (`npm run demo`, real output)

```
[1] CREATE EMPLOYEES
  bootstrap admin: demo-admin
  registered user: demo-mgr (MANAGER) / demo-emp (EMPLOYEE) / demo-other (EMPLOYEE)
  created employee: Alice Paycheck (id 25c77328-6cc...808cb50b)
  created manager : Manager Bob (id 207f56d1-bb0...10887395)
[2] AUTHENTICATE AS AUTHORIZED USER
  authenticated as demo-emp -> role=EMPLOYEE, employeeId=25c77328-6cc...808cb50b
[3+4] UPLOAD -> ENCRYPT -> STORE
  upload HTTP 201; 47 bytes; object at opaque key documents/4dd35c41-... (75 ciphertext bytes)
  plaintext leaked to storage? NO -> ciphertext-only at rest
[5] RETRIEVE AS AUTHORIZED USER
  HTTP 200; 47 bytes; content matches original? YES
[6] REJECT UNAUTHORIZED ACCESS
  unrelated employee (Mallory) -> HTTP 403 FORBIDDEN: Access denied to this document
[7] AUDIT BLOCKCHAIN (local single-node hash-linked prototype - NOT decentralized)
  chain valid=true, blocks=11 (GENESIS … EMPLOYEE_CREATED ×3 … DOCUMENT_UPLOADED … DOCUMENT_ACCESSED)
  every block shows prevHash = previous block hash
[8] TAMPER DETECTION (simulated on an in-memory copy; live chain untouched)
  live chain validation: valid=true
  modified copy validation: valid=false -> "block hash does not match its content (block was modified)"
  live chain still valid after simulation: YES
[EXTRA] REVOKE -> ACCESS_REVOKED audit
  revoke HTTP 200; status -> REVOKED; download after revoke -> HTTP 404; ciphertext purged: YES
```

## 7. Judge demonstration instructions

```powershell
cd "C:\Users\syeda\OneDrive\Desktop\blockchain"

npm install                     # first time only (deps already installed here)
npm run check                   # typecheck + lint + 54 tests (3 MinIO tests skip w/o server)
npm run demo                    # the 9-step flow above, end to end
npm start                       # optional: boot API on :3000
# then:  Invoke-RestMethod http://localhost:3000/api/health
```

With Docker available (optional, for the real MinIO backend):

```powershell
docker compose up --build
$env:MINIO_TEST="1"; npm test -- --run test/minio.integration.test.ts
```

Expected: typecheck/lint clean; **54 tests pass**; demo prints the flow above with
ciphertext-only-at-rest, exact-bytes retrieval, a 403 for the unauthorized user, an
11-block valid chain, tamper detection failure on the modified copy, and a 404 after
revocation. No step is fabricated — every printed value comes from the actual run.