# ZeroTrust HRMS — Security Controls (Phase 3 review)

This document lists what is **implemented and verified** vs. what is a clearly
labeled **future enhancement**. The review follows OWASP API Security
categories and this app's own threat model.

## Verification basis

All of the following were exercised by live HTTP requests in Phase 3
(`scripts/e2e.ts`, 38/38 green) or by the unit suite (62 green).

## Implemented & verified

| Control | Where | Evidence |
| --- | --- | --- |
| Password storage | scrypt hash (`src/auth/passwords.ts`) | tests |
| Token auth | HS256 JWT, `timingSafeEqual` verify, 1 h expiry | `tokens.ts` + tests |
| Fresh-identity RBAC | middleware re-resolves role + user→employee link per request; role change applies immediately | `middleware/auth.ts` |
| Per-route authorization | ADMIN/MANAGER/EMPLOYEE gates on employees, documents, audit | `authorization.ts`, routes |
| Employee ownership | self / direct-report / admin scoped read+write | e2e cross-record 403 |
| Document authorization | owner / manager(direct report) / admin only; revoke owner-or-admin | e2e 403s, revoke 404 |
| Encrypted-at-rest | AES-256-GCM, random IV, AAD binding, HKDF versioned keys | crypto tests + e2e at-rest proof |
| Integrity | SHA-256 over AAD‖envelope, verified on every download; tamper → 500/encryption refusal | e2e + API test |
| Object privacy | opaque UUID object keys, private MinIO bucket policy, no presigned URLs | `storage/factory.ts`, minio adapter |
| Input validation | zod schemas on body (422) and path params (400) | validation.ts + tests |
| Upload constraints | 10 MB limit (413), filename rules (400) | documents route |
| Credential exposure | `.env` in `.gitignore`; dev fallback secrets logged as such; no secrets in logs | .gitignore, index.ts |
| Audit immutability | hash-linked chain, validate endpoint, AUTH_LOGIN_FAILED recorded, masked usernames in audit/logs | blockchain tests |
| Rate limiting | login/register simple limiter | `rate-limit.ts` |
| Security headers | CSP, nosniff, XFO, referrer-policy; no `x-powered-by` | frontend tests |
| No XSS sinks | all user content `escapeHtml`-escaped before innerHTML | util.js |
| No secret leakage via SPA | `/.env` request never returns the file | frontend test |
| Error contract | `{error:{code,message}}`; 4xx for client errors; 500 details hidden unless SHOW_ERROR_DETAILS=true | errors.ts |

## Not implemented (future enhancements — clearly labeled)

- **KMS-backed key management** — `LocalKeyManager` is a KDF over a master
  secret, not a hardware/cloud KMS. Swap via the `KeyManager` interface.
- **Refresh-token rotation, MFA, SSO/IdP federation.**
- **httpOnly SameSite cookies + CSRF defense** — the SPA stores the JWT in
  `localStorage` (XSS-exposed); acceptable for the demo, not for production.
- **Centralized secrets vault** — JWT/MASTER_KEY come from env only.
  (No encrypted `.env` files, no Vault/AWS Secrets Manager integration.)
- **Hardened TLS/proxy / certificate pinning / HSTS** — not configured for a
  plain-HTTP demo environment.
- **Fabric network hardening** — dev `cryptogen` identities and a single
  orderer; see `docs/PHASE2_NETWORK_DESIGN.md`.

## Honest risk summary

The demo environment runs HTTP on localhost with dev secrets. For any real
deployment: HTTPS, real JWT_/MASTER_KEY_, KMS, cookies+CSRF, and the Fabric
network from `fabric/README.md` are required before the system is production
relevant. Nothing in this report claims otherwise.