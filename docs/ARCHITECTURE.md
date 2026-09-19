# ZeroTrust HRMS — Architecture (Phase 3)

## Final architecture

```
Browser SPA (vanilla JS, hash router)         [public/]
   │  same-origin fetch (no CORS)             #/login #/register #/dashboard
   ▼                                            #/employees  #/employees/:id  #/audit
Express 4 app  ── static /public + /api/*     [src/app.ts]
   │
   ├── auth middleware  (HS256 JWT, fresh-identity RBAC)   [src/middleware/auth.ts]
   ├── zod validation  (body 422 / param 400, 10MB limit)  [src/middleware/validate.ts]
   ├── AuthService        (scrypt + JWT, bootstrap rules)  [src/modules/auth/service.ts]
   ├── EmployeesService   (RBAC + ownership)               [src/modules/employees/service.ts]
   ├── DocumentsService   (encrypt→store→verify)           [src/modules/documents/service.ts]
   │        │
   │        ├── KeyManager  (HKDF-SHA256 versioned keys)    [src/crypto/keys.ts]
   │        ├── encryptGcm  (AES-256-GCM + AAD)             [src/crypto/encryption.ts]
   │        └── StorageAdapter
   │                 ├── FilesystemStorageAdapter          (dev/CI)
   │                 └── MinioStorageAdapter  (private bucket, opaque keys)
   ├── AuditService        (local hash-chain + optional Fabric) [src/modules/audit]
   │        ├── LocalBlockchain  (SQLite/memory, SHA-256 linked blocks)
   │        └── FabricLedger  (permissioned multi-org network, LEDGER_BACKEND=fabric)
   └── Health/error/rate-limit middleware
```

## Data at rest

- SQLite `data/hrms.db`: users, employees, documents (metadata), audit blocks.
- Filesystem `data/objects/` (or MinIO bucket `hrms-documents`): **ciphertext
  only** — `IV(12) ‖ ciphertext ‖ authTag(16)` with an AAD bound to
  realm/bucket/objectKey/contentType and a SHA-256 integrity digest.
- Audit blocks carry metadata only; never plaintext or keys.

## Frontend → backend mapping (Task 1 & 2)

| UI view | API calls |
| --- | --- |
| Login / Register | `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me` |
| Dashboard | `GET /api/health`, `GET /api/audit/chain`, `GET /api/audit/network`, `GET /api/employees` |
| Employees list | `GET /api/employees`, `POST /api/employees` |
| Employee detail | `GET|PATCH|DELETE /api/employees/:id`, `POST /api/employees/:id/role` |
| Documents | `POST|GET /api/employees/:id/documents`, `GET|DELETE .../documents/:documentId` |
| Audit history | `GET /api/audit/chain`, `GET /api/audit/validate`, `GET /api/audit/network` |

No fake responses: every value is fetched from the live backend.

## Component responsibilities

- `src/config.ts` — env-driven config, dev fallbacks clearly logged.
- `src/context.ts` — dependency wiring (DB, storage, keys, chain, ledger,
  services).
- `src/authorization.ts` — pure RBAC/ownership predicates.
- `src/blockchain/` — hash-linked audit chain (prototype) + stores.
- `src/ledger/` — Hyperledger Fabric gateway (authoritative ledger when enabled).
- `scripts/demo.ts` — in-process judge flow. `scripts/e2e.ts` — live check.
- `test/` — unit + API + live-style integration suites.

## Startup / runtime matrix

| Component | Start | Stop |
| --- | --- | --- |
| API + SPA | `npm start` (ports 3000) | Ctrl+C |
| SQLite DB | automatic on start | — |
| Filesystem storage | automatic | — |
| MinIO | `docker compose up -d minio` (requires Docker) | `docker compose down` |
| Fabric (WSL2) | `fabric/scripts/network.sh up` + channel + deploy (requires Docker) | `network.sh down` |

See `docs/JUDGE_DEMO_GUIDE.md` for the exact sequence and `docs/TEST_REPORT.md`
for what was verified in this environment.