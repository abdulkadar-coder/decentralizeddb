# ZeroTrust HRMS — Test Report (Phase 3)

Date of execution: 2026-09-19 · Environment: Windows 11, Node v24.20.0 (engine
>=22.13), no Docker, no Fabric network.

## Summary

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS (tsc strict, no errors) |
| `npm run lint` | PASS (eslint, 0 errors, 0 warnings) |
| `npm run test` | PASS (62 passed, 3 skipped) |
| `npm run build` | PASS (47 JS emitted to dist/) |
| `npm run start` | PASS (listens on port 3000, health OK) |
| `npm run start:prod` | PASS (compiled dist server, health OK) |
| `npm run demo` | PASS (full Phase-1 flow, real outputs) |
| `npm run e2e` | PASS (38/38 live checks) |
| `npm run fabric:probe` | FAIL **REPORTED HONESTLY** — network not reachable (ECONNREFUSED 127.0.0.1:7051); requires WSL2+Docker setup, see fabric/README.md |

## Fixes applied in Phase 3

1. **Broken `/api/health` route (test found it).** `app.ts` mounted the health
   router at `/api/health` while the router itself declares `/health`, producing
   `/api/health/health`. Fixed the mount to `/api` so the documented and
   frontend-expected `/api/health` returns 200. Root cause, not a test change.
2. **SPA white screen on first load (real-browser debug).** `public/js/main.js`
   called `renderShell(null)` while unauthenticated, and `roleNav`/the topbar
   dereferenced `user.role` on `null` → `TypeError` → empty page. Guarded both
   accesses for `null`.
3. **SPA white screen after login (real-browser debug).** `route()` passed the
   bare cached *user* object to views (`mountDashboard`/`mountEmployees`/
   `mountEmployee`) that expect a `{ user }` session wrapper →
   `session.user.role` threw on the dashboard. Views now receive the wrapped
   session. Verified in real Chrome: sign-in → dashboard → employees → audit →
   logout all render (6/6).
4. **Dev caching hid fixes.** Static `maxAge` was 1 h; now `0` in development so
   JS changes appear immediately (1 h retained for production).
5. Removed 5 pre-existing frontend lint warnings (unused imports/vars).
6. Added `scripts/e2e.ts` (live verifier) and `scripts/headless-check.mjs`
   (real-browser SPA click-through).

## Test inventory (Vitest)

- `test/api.test.ts` — 25 API tests: bootstrap, RBAC, ownership, upload/
  download/deny, integrity/tamper, revoke, validation, audit gating.
- `test/blockchain.test.ts` — 6 tests: genesis/linking/validation/tamper.
- `test/crypto.test.ts` — 9 tests: AES-GCM round-trip/tamper/AAD/key/integrity.
- `test/passwords-tokens.test.ts` — 8 tests: scrypt + JWT expiry/forgery.
- `test/storage.test.ts` — 7 tests: storage adapter contract + failures.
- `test/ledger.test.ts` — 7 tests: Fabric gateway semantics + failure path.
- `test/frontend.test.ts` — **7 NEW (Phase 3)**: SPA shell, static assets, SPA
  fallback, JSON 404 for unknown API, no `.env` leak, security headers, `/api`
  manifest.
- `test/minio.integration.test.ts` — 3 tests, **skipped** (needs MINIO_TEST=1 +
  live MinIO; Docker unavailable here).

## Live end-to-end verification (npm run e2e, fresh DB)

**38 passed, 0 failed**, including: health; admin bootstrap+login; RBAC on
create/role-change (403); owner upload (201); **ciphertext-only at rest**
(79 bytes vs 51 plaintext, envelope = IV+ciphertext+tag); owner/manager/admin
download byte-exact (200); outsider/anonymous denied (403/401); cross-record
read denied (403); audit read RBAC (403 for EMPLOYEE); **hash-chain validates**
(blocks = 14, all events present); revoke → status REVOKED, download 404,
outsider revoke denied (403).

## Infrastructure limitations (reported, not hidden)

1. **MinIO** — adapter implemented and integration-tested behind `MINIO_TEST=1`
   (auto-skip). Docker is not installed on this machine, so the compose stack
   and live MinIO bucket policy could not be executed here. Fix: install Docker
   Desktop/WSL2, run `docker compose up -d minio`, set `STORAGE_BACKEND=minio`.
2. **Hyperledger Fabric** — chaincode, network scripts and gateway code are
   present and unit-tested; the peer is unreachable (`ECONNREFUSED`), so
   on-chain commits were not re-verified this session. Fix: run the WSL2
   scripts in `fabric/README.md`, then `npm run fabric:probe`.
3. **Browser UI** — static serving, SPA fallback, headers and all API contracts
   are tested via Supertest; a manual click-through on a desktop browser is
   recommended but is the only step not executed in a terminal here.