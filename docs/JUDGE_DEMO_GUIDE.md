# ZeroTrust HRMS — Judge Demonstration Guide (Phase 3)

Reproducible script for the end-of-course demonstration. Everything here was
executed on this repo's Windows environment; the exact commands are below.
Two optional infrastructure pieces — **MinIO (Docker)** and the **Hyperledger
Fabric network (WSL2 + Docker)** — are documented but were **not** verified in
this environment because Docker is not installed. The core demo is fully
verifiable without them (filesystem storage + local hash chain).

---

## 0. Prerequisites

- Windows with PowerShell.
- Node.js **>= 22.13** (`node -v`) and npm (`npm -v`).
- (Optional, for the storage/blockchain extras) Docker **inside WSL2**.
- The repo unpacked, e.g. `C:\Users\<you>\Desktop\blockchain`.

## 1. Environment configuration

```powershell
cd C:\Users\<you>\Desktop\blockchain
npm install                 # installs everything (already available node_modules is fine)
Copy-Item .env.example .env # optional; the bundled .env (dev-only) also works
```

`.env` (development only) already sets working dev defaults: filesystem
storage, SQLite DB + audit chain. **Never** reuse these dev secrets in
production; generate real ones with `openssl rand -base64 48` (JWT_SECRET) and
`openssl rand -base64 32` (MASTER_KEY).

## 2. Startup commands

```powershell
# A) Automated verification gate (typecheck + lint + 65 tests):
npm run check

# B) Start the backend + frontend (single same-origin app):
npm start                   # http://localhost:3000

# C) Health check:
curl http://localhost:3000/api/health
```

The frontend is a vanilla-JS single-page app served by the same Express server
on `http://localhost:3000` — no separate build step or dev server required.

## 3. Database / storage / blockchain startup

- **Database:** created automatically on first start at `data/hrms.db`
  (SQLite, no external service). Start = `npm start`.
- **Storage:** `STORAGE_BACKEND=filesystem` writes ciphertext-only objects to
  `data/objects/` (default). No server to start.
- **Blockchain:** the local hash-linked audit chain auto-initializes (genesis
  block) inside the same SQLite DB. No server to start.
- **MinIO variant (requires Docker):**
  ```powershell
  docker compose up -d minio
  # then edit .env: STORAGE_BACKEND=minio (+ MINIO_* vars) and restart npm start
  ```
- **Fabric permissioned ledger (requires Docker inside WSL2):** see
  `fabric/README.md` (`network.sh up`, `channel.sh`, `deploy-chaincode.sh`),
  then set `LEDGER_BACKEND=fabric` and run `npm run fabric:probe`.

## 4. Demo user setup (no secrets exposed)

Register the bootstrap administrator in the UI
(`#/register`, role "Administrator") — the first ADMIN is auto-approved. Then
either register employees/manager roles through the UI (manager registration
requires an admin session) or:

```powershell
npm run e2e   # creates roles, employees, upload/download/deny/audit/revoke automatically
```

The e2e script uses one-time usernames (`e2e-*`), so it never needs the admin
password recorded anywhere.

## 5. The demonstration script

The following flow was executed and its output is in `docs/TEST_REPORT.md`.

1. **Login** — `#/login`, sign in as the bootstrap admin.
2. **Employee creation** — `#/employees` → "New employee" → fill form. A linked
   user UUID ties the record to an account.
3. **Document upload** — open the employee `#/employees/<id>`, "Upload
   document", pick a file.
4. **Encrypted storage** — verified in the e2e output: the object at rest is
   `plaintext.length + 28` bytes (12-byte IV + ciphertext + 16-byte auth tag)
   and contains no plaintext substring.
5. **Authorized access** — download as owner, manager (direct report), and
   admin: HTTP 200, byte-exact.
6. **Unauthorized access rejection** — unrelated employee download: HTTP 403
   `FORBIDDEN`; anonymous: HTTP 401; employee reading another record: 403.
7. **Blockchain audit transaction** — every action appends a hash-linked block
   (`EMPLOYEE_CREATED`, `DOCUMENT_UPLOADED`, `DOCUMENT_ACCESSED`, `AUTH_LOGIN`,
   `ACCESS_REVOKED`). `#/audit` shows the chain; `/api/audit/validate`
   re-verifies the whole chain (tamper detection).
8. **Audit history** — visible to ADMIN/MANAGER at `#/audit`; EMPLOYEE gets
   HTTP 403.
9. **Error handling** — invalid UUIDs → 400/404/422 JSON errors, uploads
   without/with invalid `X-Filename` → 400, oversized uploads → 413, missing
   storage object → 404 — the process never crashes.

## 6. Test commands

```powershell
npm run check        # typecheck + lint + vitest (69 passed, 3 MinIO tests skip w/o server)
npm run demo         # self-contained end-to-end demo (in-process server)
npm run e2e          # live end-to-end verification against http://localhost:3000 (38 checks)
npm run build        # production TypeScript build -> dist/
npm run start:prod   # run the compiled production server
npm run fabric:probe # Fabric ledger connectivity probe (requires the network up)
node scripts/headless-check.mjs   # real-Chrome SPA click-through (6/6 checks)
npm run chain:verify # print the audit chain + validation status (VALID/INVALID + reasons)
npm run chain:tamper # backup + corrupt the last audit block (needs a stopped server)
npm run chain:restore# restore the chain from data/hrms.db.bak
```

## 7. Clean-environment reset

```powershell
# Stop any running npm/node server, then:
Remove-Item -Recurse -Force data   # wipes DB + file objects for a pristine demo
npm start
```

If the UI ever shows a stale white page after a code change, hard-refresh once
(`Ctrl+F5`) — dev static caching is now disabled, so this is only needed if the
browser still holds an old cached copy.

## 8. Explaining the blockchain to the judge

Ad-lib version of the elevator pitch (30 s):

> *"Every sensitive action — login, employee create, file upload/download,
> revoke — is appended as a transaction to a tamper-evident audit chain. Each
> block carries the SHA-256 hash of everything before it, so editing an old
> record breaks every block after it, and the system detects and reports that.
> The chain never touches file contents, passwords, or keys — metadata only."*

Mechanics, pointed at the `#/audit` page:

- **Block anatomy** — each row is `{ height, tx, prevHash, hash }`
  (`src/blockchain/blockchain.ts`).
- **Genesis** — block 0 is a `GENESIS` record whose `prevHash` is 64 zeroes.
- **The hash is a fingerprint of everything** — `sha256("zerotrust-hrms/audit/v1"
  + height + timestamp + prevHash + canonical-tx-JSON)`; the tx JSON is
  key-sorted so the hash is deterministic.
- **The link** — every new block's `prevHash` is the previous block's `hash`,
  so block N chains back to genesis. That is why the term *blockchain*.
- **Verification on demand** — the audit view re-walks the whole chain,
  re-checking every link and re-computing every hash (`validateChain()`), and
  reports VALID / broken-with-reason.

The live proof — a 60-second tamper demo (server stopped):

```powershell
npm run chain:tamper     # 1. snapshot + corrupt the LAST audit block
npm run chain:verify     # 2. chain reports INVALID: "block hash does not match its content (block was modified)"
npm start                # 3. (optional) open #/audit - the page shows the chain as broken
# then, still with the server stopped:
npm run chain:restore    # 4. restore the snapshot
npm run chain:verify     # 5. chain is VALID again - the altered record worked exactly when it wasn't on the chain
```

Say: *"Anyone who altered a recorded action breaks the link to the next block
and the recomputed hashes no longer match — the very same mechanism catches it
in on-disk database tampering."*

Honesty caveat (say it first, un-asked):

> *"This deployment runs a single-node, SQLite-backed chain — a prototype of the
> tamper-evident mechanism, not a decentralized multi-peer network. The repo
> ships a Hyperledger Fabric bridge (`src/ledger/fabric.ts`) plus chaincode so
> the same records can be committed to a permissioned distributed ledger, but
> that peer needs Docker/WSL2, which isn't available on this machine. The core
> zero-knowledge-at-rest guarantee — files are never stored in plaintext — is
> fully live today."*

## 9. Final check-list for the judge

- [ ] `npm run check` — all green.
- [ ] `npm start` → `http://localhost:3000/api/health` returns
      `{"status":"ok",...}`.
- [ ] `http://localhost:3000/` renders the ZeroTrust HRMS SPA.
- [ ] `npm run e2e` → `RESULT: 38 passed, 0 failed`.
- [ ] UI: login → create employee → upload → download → audit page shows the
      hash chain → logout.
- [ ] `npm run chain:verify` reports `VALID` (shows the live hash chain).
- [ ] Tamper demo: `npm run chain:tamper` → `npm run chain:verify` reports
      `INVALID` → `npm run chain:restore` → `npm run chain:verify` reports
      `VALID` again.