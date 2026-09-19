# ZeroTrust HRMS — Phase 1, Phase 2 & Phase 3

Production-oriented **Decentralized Zero-Trust Employee Data Management System**:
**Phase 1** = Secure Backend Foundation and Storage; **Phase 2** = a real
permissioned **Hyperledger Fabric** multi-organization audit network integrated
with the backend through the Fabric Gateway SDK; **Phase 3** = the integrated
frontend, live end-to-end verification, security review, and judge
demonstration guide.

A Node.js/TypeScript REST API with a same-origin vanilla-JS SPA frontend:

- Authentication (scrypt password hashing, HS256 JWT) and Role-Based Access Control (ADMIN / MANAGER / EMPLOYEE)
- Employee CRUD with strict ownership enforcement
- **AES-256-GCM** document encryption with **Additional Authenticated Data (AAD)** context binding
- HKDF-derived, versioned data-encryption keys behind a `KeyManager` interface
- SHA-256 integrity hashes verified on every download
- Opaque object identifiers, encrypted-at-rest object storage behind a `StorageAdapter` interface
  - `minio` backend (real MinIO SDK, private bucket, no public URLs) + `filesystem` backend for dev/CI
- Local **hash-linked audit blockchain** (SHA-256, prev-hash linking, chain validation, tamper detection)
- Automated tests (Vitest + Supertest), ESLint, TypeScript strict mode

---

## Features & how it works

The product promise: **files are never stored or logged in plaintext, every
access decision is re-checked server-side, and every sensitive action lands in
a tamper-evident chain.** Below is the full walkthrough of each feature.

### 1. Identity & authentication — `src/modules/auth/service.ts`, `src/auth/`

- **Role-aware, least-privilege registration.** Self-service sign-up only grants
  `EMPLOYEE`. Creating a `MANAGER` account requires an authenticated ADMIN.
  `ADMIN` is **bootstrap-only**: the first account can self-register as
  Administrator; afterwards only an ADMIN may create another ADMIN, and any other
  actor is refused with *"Only administrators can create admin accounts"*
  (`service.ts:99-112`).
- **Passwords never stored.** Passwords are salted-hashed (`src/auth/passwords.ts`);
  only the hash exists on disk.
- **Login → JWT.** `POST /api/auth/login` verifies the password and returns a
  signed HS256 JWT (`sub`, `username`, `role`, optional `employeeId`, expiry).
  Successful and failed logins both become audit blocks.
- **Fresh-identity RBAC.** The auth middleware re-resolves role + the
  `user → employee` link from the database on **every** request
  (`resolveForAuth`, `service.ts:73`), so role changes, re-links, and account
  deactivation take effect immediately — not at token expiry
  (`middleware/auth.ts:51-61`).

### 2. Zero-trust authorization — `src/authorization.ts`

Centralized policies (`canViewEmployee`, `canManageEmployee`,
`canAccessDocument`, `canListUnder`):

| Operation | ADMIN | MANAGER | EMPLOYEE |
| --- | --- | --- | --- |
| View/edit employee | all records | direct reports only | self only |
| Upload / download documents | all | direct reports | self only |
| Create / delete employees, change roles | ✅ | ❌ | ❌ |
| Read audit chain | ✅ | ✅ | ❌ |

The UI mirrors this (role-aware nav), but the **routes also enforce it**:
a plain `GET /api/audit/chain` from an EMPLOYEE returns HTTP 403.

### 3. Employees — `src/modules/employees/service.ts`

- ADMIN creates records and can link them to a login account (`user_id`);
  a link can't be reused by another employee (`assertNotActiveUserLinked`).
- Manager assignment (`managed_by`) drives every manager scope decision.
- Optimistic `version` counter, soft-delete (`is_active = 0`, which also
  deactivates the linked account).
- Role changes (`POST /:id/role`) rewrite `users.role` and emit `ROLE_CHANGED`.
- Every create/update/delete is recorded in the audit chain.

### 4. Documents — the encryption core — `src/modules/documents/service.ts`, `src/crypto/`

- **Upload** (`service.ts:95`): bumps a per-family key version (HKDF-SHA256
  derived from the master key — `keys.ts`), encrypts with **AES-256-GCM**
  (random 12-byte IV, 128-bit tag), and **binds each object to its real
  storage context via AAD** (`realm + bucket + objectKey + contentType`).
  The stored envelope is `iv ‖ ciphertext ‖ tag` — plaintext never touched disk.
- **At rest:** only the sealed blob reaches the storage adapter. The DB row
  records the key id/version, AAD hex, and an extra `integrity_sha256`
  (SHA-256 of `AAD ‖ envelope`).
- **Download** (`service.ts:159`): re-checks entitlement, verifies the stored
  object's metadata (key id/version/integrity) matches the record, then
  decrypts. Two independent checks — the GCM tag **and** the SHA-256 digest —
  mean tampering with any file in `data/objects/` fails the download with
  `ENCRYPTION_FAILURE`.
- **Revoke** (`service.ts:208`): deletes the ciphertext from storage **and**
  marks the record `REVOKED`, so later downloads are 404/403. Emits
  `ACCESS_REVOKED`.
- **Limits:** empty uploads rejected; > 10 MB → 413.

### 5. Storage backends — `src/storage/`

`STORAGE_BACKEND` selects **filesystem** (ciphertext under `data/objects/`) or
**MinIO/S3** (`MinioStorageAdapter`: private bucket, no public/presigned URLs,
opaque UUID keys, credentials from env only). Adapters only ever see sealed data.

### 6. Tamper-evident audit blockchain — `src/blockchain/blockchain.ts`

- Every audited action appends `Block { height, tx, prevHash, hash }`.
- `hash = SHA256("zerotrust-hrms/audit/v1" + height + timestamp + prevHash +
  canonical-tx)`, where the tx JSON is key-sorted so the hash is deterministic.
- Block 0 is **GENESIS** with `prevHash = 64 zeros`; every later block's
  `prevHash` is the previous block's hash — a literal **hash chain**.
- `validateChain()` re-walks the chain recomputing every hash and link and
  reports VALID or the exact broken block/reason. The Audit page and
  `/api/audit/validate` surface the result.
- **Metadata only** — never plaintext documents, passwords, or keys
  (`blockchain.ts:17`).
- Live tamper demo tooling: `npm run chain:tamper`, `npm run chain:verify`,
  `npm run chain:restore` (see *Demo script*).
- **Fabric bridge (Phase 2):** with `LEDGER_BACKEND=fabric`, submittable events
  are committed to the permissioned multi-org network first (authoritative),
  with the local chain as a mirror (`audit/service.ts:50-66`).

### 7. API hardening — `src/middleware/`, `src/validation.ts`

- Zod validation on every route (usernames, roles, `X-Filename`, …).
- Sliding-window **rate limiting** on public login/register (per IP).
- Structured JSON errors `{ error: { code, message } }` — never HTML.
- Security headers (CSP `script-src 'self'`, no inline handlers) and no `.env`
  exposure; usernames are masked in failed-login audit payloads
  (`service.ts:135`).

### 8. Frontend SPA — `public/js/`

Vanilla-JS, jQuery-free, hash-routed (`#/login`, `#/register`, `#/dashboard`,
`#/employees/:id`, `#/audit`), CSP-compliant (no inline handlers), all user
text escaped (XSS-safe), role-aware nav, loading/error toasts. Views reproduce
the server's authorization behavior; the server is the source of truth.

### 9. Configuration — `.env`

Selects storage + blockchain backends, JWT secret, token TTL, master key.
Dev-only defaults are shipped for convenience; production must set real secrets
(never commit) — see `docs/SECURITY.md`.

### 10. Verification tooling

- `npm run check` — typecheck + lint + **69 tests**.
- `npm run e2e` — **38 live endpoint checks** against a running server.
- `node scripts/headless-check.mjs` — **6/6 real-Chrome click-throughs**
  (sign-in → dashboard → employees → audit → logout).
- `npm run chain:tamper|verify|restore` — live blockchain tamper demonstration.

---

## Phase 3 — Frontend + live verification (highlights)

- Same-origin SPA under `/` (hash routing): login, registration, role-aware
  dashboard, employee directory/detail, encrypted document upload/download/
  revoke, audit history, blockchain transaction status, logout, loading states,
  validation and error toasts. CSP-compliant (no inline handlers), all user
  text escaped (XSS-safe).
- `npm run e2e` — live end-to-end verifier against the running API
  (`http://127.0.0.1:3000`, override with `E2E_URL`). **38/38 checks green** on
  a fresh database (auth, RBAC, ownership, encryption-at-rest proof, authorized
  download, 401/403 denials, hash-chain integrity, revoke/purge).
- Security review and honest future-enhancement list: `docs/SECURITY.md`.
- Judge walkthrough: `docs/JUDGE_DEMO_GUIDE.md`. Phase 3 results:
  `docs/TEST_REPORT.md`. Architecture: `docs/ARCHITECTURE.md`.

> **IMPORTANT:** The local `blockchain` module is a **single-node local prototype**,
> NOT a decentralized multi-node network. There is no consensus, p2p gossip, or
> distributed ledger. Never store document plaintext or encryption keys inside
> audit blocks. The **Phase 2 Fabric network is the authoritative multi-org
> ledger** when enabled; the local chain remains a built-in mirror and is never
> claimed to be decentralized.

---

## Phase 2 — Hyperledger Fabric audit network (highlights)

A real Fabric v2.5 network (4 orgs + orderer, TLS, `2-of-4` endorsement
policy) records authoring events via `src/ledger/fabric.ts`
(`@hyperledger/fabric-gateway`). Opt in with `LEDGER_BACKEND=fabric`; default
`off` behaves exactly like Phase 1.

- Chaincode `hrmsauditcc` (channel `hrmsaudit`) — append-only records:
  `submitAudit/querySeq/queryAll/queryBySubject/queryByType/verifyChain`.
- Read-only live check: `npm run fabric:probe`; write+read probe with
  `FABRIC_PROBE_SUBMIT=1`.
- `GET /api/audit/network` (ADMIN/MANAGER) exposes connection state, sequence,
  on-chain hash-chain validation and the committed records.
- Submittable event types (`EMPLOYEE_CREATED`, `EMPLOYEE_UPDATED`,
  `ROLE_CHANGED`, `DOCUMENT_UPLOADED`, `DOCUMENT_ACCESSED`, `ACCESS_REVOKED`)
  are submitted to the network **before** any local append; on network failure
  the call fails with `LEDGER_FAILURE` (503) and nothing is stored locally —
  the network is authoritative, never a "best effort footer".
- Run/operate: see `fabric/README.md`. Honest design + limitations:
  `docs/PHASE2_NETWORK_DESIGN.md` (single orderer, dev keys, permissioned).
- Report with real run transcript: `docs/PHASE2_REPORT.md`.

```powershell
# 1. (WSL) bring the network up and deploy (see fabric/README.md)
# 2. (Windows) enable the gateway and probe it
$env:LEDGER_BACKEND="fabric"
npm run fabric:probe     # -> connected, seq, verifyChain intact
```

---

## Requirements

- Node.js **>= 22.13** (uses the built-in `node:sqlite` — no native DB dependency)
- npm **>= 10**
- Docker (optional) for the MinIO storage backend

## Quickstart

```powershell
# 1. Install dependencies
npm install

# 2. Run the full verification gate (typecheck + lint + tests)
npm run check

# 3. Run the reproducible end-to-end demonstration (no fabrication)
npm run demo

# 4. Start the API (defaults to filesystem storage + SQLite audit chain)
npm start
# Health check:  GET http://localhost:3000/api/health

# 5. While it runs, verify the full Phase 3 live flow (38 checks)
npm run e2e
```

A development `.env` is provided. Copy `.env.example` for reference. Production
deployments must set real `JWT_SECRET` and `MASTER_KEY` (never hardcode or commit secrets).

### Verify key derivation / zero plaintext

The docs are created with `mode: "strict"` and checked with `npm run typecheck`,
`npm run lint`, and the full Vitest suite (`npm test`).

---

## Security design

### Storage pipeline

```
Plaintext document
  → DocumentsService.upload
    → KeyManager.bumpVersion("documents")        (HKDF-SHA256 from MASTER_KEY, per-version keys)
    → encryptGcm                                  (AES-256-GCM, random 12-byte IV, 128-bit auth tag)
      → setAAD(canonical context)                 (realm/bucket/objectKey/contentType binding)
    → envelope = IV || ciphertext || authTag
    → integritySha256 = SHA256(AAD || envelope)
  → StorageAdapter.put(opaqueKey, envelope, metadata)
  → SQLite document row (opaque key, key id/version, AAD hex, integrity hash)
```

Download reverses the pipeline and enforces **all** of the following before a byte is
returned to the caller:

1. Authorization (owner / reporting manager / admin)
2. Storage object metadata matches the DB record
3. SHA-256 integrity re-check (tamper detection at rest)
4. AAD match (context rebinding)
5. GCM auth-tag verification (invalid ciphertext rejection)

**Why AAD:** the canonical AAD `realm/bucket/objectKey/contentType` cryptographically
binds each ciphertext to its application context. Replaying an object into a different
bucket/key/type fails tag verification.

### Key management — honest limitations

`LocalKeyManager` deterministically derives AES-256-GCM keys from a single master
secret using HKDF-SHA256. It is cryptographically sound for encrypted-at-rest data and
provides versioned keys (a fresh key version per document), but it is **not** a
production KMS. It lacks hardware-backed storage, centralized key rotation policy,
cloud-KMS audit trails, and access control over the master secret.

Production recommendation: replace `LocalKeyManager` with an implementation of the same
`KeyManager` interface backed by a real KMS (AWS KMS, GCP Cloud KMS, Azure Key Vault,
HashiCorp Vault Transit). The app is fully wired through the interface; only the
`createAppContext` factory needs the swap.

### Zero-trust access model

- Every authenticated request re-resolves the user's **current** role and `user_id →
  employee_id` link from the database (fresh-identity RBAC), so role changes and
  employee re-assignments take effect immediately rather than on token expiry.
- Employee ownership rules:
  - ADMIN: everything.
  - MANAGER: their own record + direct reports (`employees.managed_by = manager employee id`).
  - EMPLOYEE: only their own record.
- Document rules are identical to employee rules; plus managers manage documents of
  direct reports, and owners may revoke their own documents.
- Audit history is read-only for ADMIN and MANAGER.

---

## Object storage

`StorageAdapter` interface (`src/storage/types.ts`):

```ts
put(key, body, metadata?)       // encrypted objects only
get(key) -> { body, size, metadata }
stat(key) -> { key, size, metadata }
remove(key)
exists(key)
ping()
```

- `FilesystemStorageAdapter` — local dev/CI backend. Stores **only ciphertext** (the
  encryption layer runs upstream) with a `.meta.json` sidecar.
- `MinioStorageAdapter` — real MinIO SDK (S3). Creates a bucket with an explicitly
  private policy (secure-transport deny), never generates presigned/anonymous URLs,
  never accepts user-controlled keys (keys are opaque UUIDs validated by
  `assertOpaqueKey`), maps missing objects to `StorageNotFoundError` and failures to
  `StorageUnavailableError`. Credentials come only from environment variables.

Select with `STORAGE_BACKEND=filesystem|minio`.

### MinIO with Docker

```powershell
docker compose up --build          # starts MinIO (9000) + app (3000)
```

Set `STORAGE_BACKEND=minio` and the `MINIO_*` variables in `.env` (see `.env.example`).

### MinIO integration tests

The adapter's live integration tests are gated behind `MINIO_TEST=1` and skip
automatically elsewhere:

```powershell
docker compose up -d minio
$env:MINIO_TEST="1"
npm test -- --run test/minio.integration.test.ts
```

---

## Local blockchain audit module

`src/blockchain/blockchain.ts`

- Block: `{ height, tx, prevHash, hash }` where `hash = SHA256(canonical(height|timestamp|tx|prevHash))`
- Genesis block: `height 0`, `prevHash = "0".repeat(64)`
- Appends are last-write-wins; every block links to the previous block's hash
- `validateChain(blocks)` is a pure function — verified on the live chain and usable on
  copies to demonstrate tamper detection without mutating data
- Persisted in SQLite (`audit_blocks`); in-memory store available for isolated tests/demos

Audit event types: `EMPLOYEE_CREATED`, `EMPLOYEE_UPDATED`, `EMPLOYEE_DELETED`,
`ROLE_CHANGED`, `DOCUMENT_UPLOADED`, `DOCUMENT_ACCESSED`, `ACCESS_REVOKED`,
`AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `GENESIS`.

Blocks carry **metadata only** (ids, timestamps, event types, digest references) —
never plaintext documents or encryption keys.

---

## API reference

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | public | DB + storage + blockchain health |
| POST | `/api/auth/register` | public / admin* | Register user (`role` ADMIN only during first-bootstrap or by an admin) |
| POST | `/api/auth/login` | public | Login → JWT |
| GET | `/api/auth/me` | auth | Current user + live employee link |
| POST | `/api/employees` | ADMIN | Create employee |
| GET | `/api/employees` | auth | List (scoped by role) |
| GET | `/api/employees/:id` | auth | Get (owner / manager / admin) |
| PATCH | `/api/employees/:id` | auth | Update (scoped fields per role) |
| DELETE | `/api/employees/:id` | ADMIN | Soft-delete + revoke linked user |
| POST | `/api/employees/:id/role` | ADMIN | Change role (`ROLE_CHANGED`) |
| POST | `/api/employees/:id/documents` | auth | Upload (raw bytes, `X-Filename` header) → encrypt+store |
| GET | `/api/employees/:id/documents` | auth | List document metadata |
| GET | `/api/employees/:id/documents/:documentId` | auth | **Authorized** decrypt + download |
| DELETE | `/api/employees/:id/documents/:documentId` | auth | Revoke + purge + `ACCESS_REVOKED` |
| GET | `/api/audit/chain` | ADMIN/MANAGER | Readable audit history (local mirror) |
| GET | `/api/audit/validate` | ADMIN/MANAGER | Chain validation result |
| GET | `/api/audit/network` | ADMIN/MANAGER | **Phase 2:** Fabric network state + on-chain verifyChain |

Upload limits: max **10 MB** per document. Upload filenames are validated against path
separators/control characters.

Error contract: `{ "error": { "code", "message" } }` with HTTP statuses
`400/401/403/404/409/413/422/500/503`. `ENCRYPTION_FAILURE` covers integrity or
auth-tag verification failures; `STORAGE_FAILURE` covers object-storage outages.

---

## Tests

```powershell
npm test          # Vitest, 69 tests (3 MinIO tests skipped unless MINIO_TEST=1)
npm run typecheck # tsc --noEmit (strict)
npm run lint      # ESLint flat config
npm run check     # all three
```

Phase 2 adds 7 `src/ledger` tests (Fabric gateway submission semantics,
authoritative-ledger failure behavior, config gating) in `test/ledger.test.ts`;
Phase 3 adds 7 frontend-delivery tests (SPA shell, static assets, SPA fallback,
API 404, no `.env` leak, security headers, `/api` manifest) in
`test/frontend.test.ts`;

Coverage areas: AES-GCM round-trip/tamper/AAD/key/integrity rejection; HKDF key
derivation; scrypt + JWT (expiry, forgery, wrong-secret); blockchain genesis/linking/
validation/tamper/broken-link; storage interface contract (put/get/stat/remove,
missing objects, opaque-key rejection, failure wrapping); full API flow (bootstrap,
RBAC, ownership, upload/download/deny, revoke, missing content, tampered ciphertext,
audit, input validation); SPA delivery (shell, fallbacks, security headers, `/api`
manifest) in Phase 3.

---

## Demo script

`npm run demo` reproduces the full judge flow on ephemeral data (nothing is fabricated):

1. Bootstrap admin + create manager/employee/other users
2. Create employee records and link ownership
3. Authenticate as the employee
4. Upload a document → confirm ciphertext-only at rest
5. Download as the authorized user → exact byte match
6. Reject an unrelated employee attempt (403)
7. Print the audit blockchain
8. Simulate a block modification on an in-memory copy → validation fails; live chain unaffected
9. Revoke → confirm storage purge + `ACCESS_REVOKED` audit, download → 404

`npm run e2e` performs the same class of checks against a **live running API**
and prints a `RESULT: N passed, M failed` summary (38/38 on a fresh DB,
re-runnable with `E2E_ADMIN_USER`/`E2E_ADMIN_PASS` for an existing admin).

`node scripts/headless-check.mjs` drives real Chrome (CDP) through the complete
SPA flow (6/6 on a fresh DB): sign-in page → authenticated dashboard →
employees → audit → logout.

**Live blockchain tamper demo** (60 s, server stopped):

```powershell
npm run chain:tamper     # 1. snapshot + corrupt the LAST audit block
npm run chain:verify     # 2. reports INVALID: "block hash does not match its content (block was modified)"
npm start                # 3. (optional) the #/audit page shows the chain as broken
npm run chain:restore    # 4. restore the snapshot (any time, server stopped)
npm run chain:verify     # 5. chain is VALID again
```

Rebuilding a pristine demo database:

```powershell
# stop npm, then:
Remove-Item -Recurse -Force data    # wipes DB + file objects
npm start
```

---

## Limitations

- Local blockchain module is a single-node prototype (Phase 1); the real
  multi-org ledger is the Phase 2 Fabric network, which is itself limited:
  **single orderer, one peer per org, dev-only cryptogen keys** (see
  `docs/PHASE2_NETWORK_DESIGN.md` §7).
- `LedgerBackend` (`LEDGER_BACKEND`) is authoritative-append with **no
  replay mirror**: non-submittable events (e.g. `AUTH_LOGIN`) are local-only.
- `LocalKeyManager` is KDF-based, not a cloud KMS (see limitations above).
- Filesystem storage backend is for dev/CI; use MinIO for anything beyond local.
- MinIO integration tests require a live server (gated by `MINIO_TEST=1`).
- Phase 3 verification environment had **no Docker**, so the MinIO compose
  stack and the WSL2 Fabric network could not be exercised live here — the
  exact fix commands are in `docs/TEST_REPORT.md` and `fabric/README.md`.
- No refresh-token rotation, MFA, or external identity federation yet.
- No employee document content in sync/backup pipelines (encrypted objects only).

## Reports

- Phase 1: `docs/PHASE1_REPORT.md` (audit record, commands, judge demo).
- Phase 2: `docs/PHASE2_REPORT.md` (real Fabric run transcript + test sweep).
- Phase 3: `docs/TEST_REPORT.md` (this session's results), `docs/SECURITY.md`
  (implemented controls + future enhancements), `docs/ARCHITECTURE.md`,
  `docs/JUDGE_DEMO_GUIDE.md` (reproducible judge walkthrough).