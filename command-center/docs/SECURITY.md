# Security model

## Non-negotiables

1. **We never store bank usernames, passwords, or any bank credential.** They are
   entered only in the aggregation provider's own hosted flow (Plaid Link), which
   runs in the user's browser and posts credentials directly to the provider. Our
   servers never see them, and there is no code path, endpoint, or column capable of
   accepting them.
2. **Provider API keys never reach the browser.** `PLAID_CLIENT_ID` and
   `PLAID_SECRET` are read only in server modules. No provider secret is ever given a
   `NEXT_PUBLIC_` prefix; `lib/env.ts` fails startup if one is.
3. **A payment is never initiated without explicit user confirmation**, and the UI
   never shows a bill as paid unless a transaction match or a provider confirmation
   says so.

## The link flow, and where the trust boundary sits

```
Browser                          Our server                    Plaid
  |                                  |                            |
  |-- POST /api/link/token --------->|                            |
  |                                  |-- /link/token/create ----->|   (server keys)
  |<---------- link_token -----------|<---------- link_token -----|
  |                                                               |
  |== Plaid Link opens; credentials go browser -> Plaid ONLY =====>|
  |<---------------------- public_token --------------------------|
  |                                  |                            |
  |-- POST /api/link/exchange ------>|                            |
  |   (public_token only)            |-- /item/public_token/exchange ->|
  |                                  |<--------- access_token ----|
  |                                  |  encrypt (AES-256-GCM), store
  |<----------- {ok} ----------------|
```

The `public_token` is single-use and short-lived; it is worthless to an attacker who
intercepts it after exchange. The `access_token` is long-lived and therefore never
leaves the server and never sits in plaintext at rest.

## Encryption at rest

Provider access tokens and TOTP secrets are sealed with **AES-256-GCM** envelope
encryption (`lib/crypto/envelope.ts`):

- 32-byte key from `ENCRYPTION_KEY` (base64), never checked into the repo.
- Random 12-byte IV per record; the 16-byte auth tag is stored alongside.
- A `keyVersion` column on every sealed record so keys can be rotated by
  re-sealing records with a new version rather than a downtime migration.
- Additional authenticated data binds the ciphertext to its record type, so a
  ciphertext lifted from one column cannot be replayed into another.

The database itself is expected to be encrypted at rest by the provider
(Supabase/Neon/RDS all do this); application-level encryption is the second layer
that protects against a leaked backup or a read-only SQL compromise.

## Authentication

**Passwords** are hashed with **scrypt** (N=2^15, r=8, p=1, 64-byte output) and a
16-byte per-user random salt, using Node's built-in `crypto` — no native build step,
no third-party dependency in the credential path. Verification is constant-time
(`timingSafeEqual`). Login responses are indistinguishable between "no such user"
and "wrong password", and both paths pay the same hashing cost so timing does not
leak account existence.

**Sessions** are opaque 256-bit random tokens. The database stores only
`sha256(token)`, so a database read does not yield usable sessions. The cookie is
`HttpOnly`, `Secure` (outside development), `SameSite=Lax`, and path-scoped.
Sessions carry both a 30-day absolute expiry and a 7-day idle timeout, are bound to
the originating user agent, and can be revoked individually or in bulk (revoking all
sessions is what a password change does).

**MFA** is implemented, not merely "ready": TOTP per RFC 6238 (SHA-1, 6 digits,
30-second step, ±1 step drift) in `lib/auth/totp.ts`, with the secret encrypted at
rest and ten single-use hashed backup codes. Sessions track `mfaSatisfied`
separately from authentication, so step-up challenges for sensitive operations are a
flag check rather than a re-architecture. Enrollment requires proving a valid code
before MFA is switched on, so a user cannot lock themselves out with a mis-scanned
QR code.

## Authorization

Every request resolves to a `(user, workspace, role)` triple via
`requireSession()` / `requireRole()` in `lib/auth/guards.ts`.

Roles and what they may do:

| Role | Read | Edit categories/bills | Link/unlink institutions | Initiate payments | Manage members |
| --- | :-: | :-: | :-: | :-: | :-: |
| `OWNER` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ADMIN` | ✓ | ✓ | ✓ | ✓ | — |
| `MEMBER` | ✓ | ✓ | ✓ | — | — |
| `ACCOUNTANT` | ✓ | ✓ | — | — | — |
| `VIEWER` | ✓ | — | — | — | — |

Tenant isolation is structural: service functions take a `WorkspaceScope` value that
can only be produced by the session guard, and every Prisma query in `lib/services`
includes its `workspaceId`. An IDOR attempt (`PATCH /api/accounts/{someone-elses-id}`)
fails as a not-found because the scope is part of the `where` clause, not a check
performed after the row is loaded.

## Payment safety

The payment flow is deliberately two-phase and cannot be collapsed into one call:

1. `POST /api/payments` creates a `DRAFT`, runs the cash-reserve check, and returns a
   confirmation summary containing the exact sentence the user must approve —
   *"You're about to pay $1,850.00 from Chase Business Checking ending in 1234."* —
   together with a single-use confirmation token.
2. `POST /api/payments/{id}/confirm` requires that token, the payment being in
   `PENDING_CONFIRMATION`, and a role permitted to move money. Only then is the
   provider called.

`COMPLETED` is reachable only from a provider confirmation (webhook or polled
status), never from a UI action. Marking a bill paid by hand sets the *bill
occurrence* to paid and records who did it; it does not fabricate a `Payment`.

Every step — created, scheduled, modified, cancelled, completed, failed — writes an
`AuditLog` row with actor, IP, user agent, and the before/after amounts.

## Cash-flow protection

Before a payment is scheduled, the funding account's available balance is compared
against the applicable `CashReserveRule` (entity-specific, else the ledger default).
A projected breach returns a warning in the confirmation summary — *"This payment
may reduce available cash below your $2,000 minimum cash threshold."* It is a
warning, not a block: the user decides.

## Audit logging

`AuditLog` is append-only (no update or delete path exists in any service) and
records: sign-in success and failure, sign-out, password change, MFA enrollment and
challenges, session revocation, institution link and unlink, sync runs, account
entity reassignment, rule creation, bill changes, and the entire payment lifecycle.
Each row carries actor, workspace, action, resource type and id, IP, user agent, and
a JSON metadata blob. It is exposed read-only in Settings.

## Transport and headers

HTTPS only. `next.config.ts` sets HSTS with preload, a Content-Security-Policy that
allows scripts only from self and Plaid's CDN, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
and a `Permissions-Policy` that disables camera, microphone, and geolocation.

## Rate limiting

Auth endpoints (login, register, MFA verification) and payment endpoints are rate
limited per IP and per account. The MVP ships an in-process limiter with a documented
swap to Redis/Upstash for multi-instance deployments — an in-memory limiter is honest
about being per-instance rather than pretending to be a global guarantee.

## Webhook verification

Plaid webhooks are verified using Plaid's JWT verification key endpoint before the
body is parsed, with the key cached and the JWT's `iat` checked for freshness.
An unverified webhook is dropped and logged; it never triggers a sync.

## Known gaps for production hardening (Phase 12)

- The rate limiter is per-instance and must move to Redis before horizontal scaling.
- Session cookies would benefit from `__Host-` prefixing once a fixed domain exists.
- Backup-code regeneration and a device/session management UI exist at the API level
  but have minimal UI.
- No automated key-rotation job yet; `keyVersion` makes it possible but it is manual.
