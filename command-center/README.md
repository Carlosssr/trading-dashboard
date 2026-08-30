# Financial Command Center

Personal and business finances in one view, kept structurally separate underneath.

Connect financial institutions, sync balances and transactions automatically, and
see net worth, cash, debt, bills, business P&L, and real-estate equity in one
place — without ever commingling the two sets of books.

## Running it

Requires Node 22+ and PostgreSQL 16+.

```bash
cd command-center
cp .env.example .env      # then fill in DATABASE_URL and the two generated secrets
npm install
npm run db:deploy         # apply migrations
npm run db:seed           # demo workspace with a year of realistic data
npm run dev
```

Sign in with **demo@example.com** / **DemoPassword123!**

Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Running without Plaid credentials

`AGGREGATION_PROVIDER=demo` (the default) runs the entire application —
institution linking, account sync, transaction sync, categorization, recurrence
detection, bills, payments, insights — against a deterministic synthetic
provider. Nothing is stubbed out: the demo adapter implements the same interface
as the Plaid adapter and the same pipeline runs end to end.

Set `AGGREGATION_PROVIDER=plaid` with `PLAID_CLIENT_ID` and `PLAID_SECRET` to
connect real institutions.

## Checking it

```bash
npm run typecheck   # strict TypeScript, no errors tolerated
npm run verify      # recomputes the headline figures and asserts the invariants
npm run test:pages  # visits every page, checks for errors and overflow
npm run test:e2e    # exercises the write paths against a running server
```

`npm run verify` is the interesting one: it recomputes net worth, cash, debt,
bills, and recurrence from the same pure functions the dashboard uses, then
asserts that combined net worth equals the two ledgers summed, that no row's
denormalized ledger disagrees with its entity, that no provider access token is
stored in plaintext, and that no payment is marked complete without a provider
confirmation.

`test:pages` and `test:e2e` need a server running (`npm run build && npm start`).

## What is where

```
app/(auth)/            Sign in, sign up, MFA challenge
app/(dashboard)/       Every dashboard page
app/api/               Route handlers — the write path

lib/finance/           Pure money math. Plain data in, plain data out, the
                       current date always a parameter. No Prisma, no I/O.
lib/services/          Application services. The only place that touches Prisma.
lib/providers/         Aggregation provider interface, plus Plaid and demo adapters
lib/auth/              Sessions, password hashing, TOTP, RBAC guards
lib/crypto/            AES-256-GCM envelope encryption

prisma/                Schema, migrations, and the seed
docs/                  Architecture, data model, API, security, MVP plan
```

## The two ideas worth knowing

**Personal and business books are separate in the schema, not in the UI.** Every
account, transaction, bill, payment, and property is owned by an entity that
declares a `PERSONAL` or `BUSINESS` ledger, and that ledger is denormalized onto
each row. No query sums across both before subtotalling — the combined figure is
always the sum of two independently computed subtotals. Moving an account between
entities rewrites the ledger on the account and all of its transactions in one
database transaction.

**Tracking a bill and paying a bill are different operations.** A bill occurrence
becomes `PAID` only from evidence: a matched transaction, a provider-confirmed
payment, or an explicit action by a person — and the UI shows which. Initiating a
payment is two-phase: the first call returns the exact sentence to approve plus a
single-use token, and only the second call reaches a payment provider. `COMPLETED`
is reachable from exactly one function, called by provider confirmations.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, provider abstraction, sync design, money representation |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Every model and the decisions behind it |
| [docs/API.md](docs/API.md) | Endpoints, conventions, the shared filter contract |
| [docs/SECURITY.md](docs/SECURITY.md) | Trust boundaries, encryption, auth, payment safety, known gaps |
| [docs/MVP-PLAN.md](docs/MVP-PLAN.md) | The twelve phases and what each delivered |

## Security in one paragraph

Bank credentials are never entered in this application, never transmitted to it,
and cannot be stored by it — they go to the aggregation provider's own flow.
Provider access tokens and TOTP secrets are sealed with AES-256-GCM under a
versioned key. Passwords use scrypt; sessions are opaque tokens stored only as
hashes. Tenant isolation is structural: services take a scope value that only a
session guard can produce, so a cross-workspace request fails as not-found rather
than relying on a check someone might forget. Every security- and money-relevant
action writes to an append-only audit log. Full detail, including what is *not*
done yet, is in [docs/SECURITY.md](docs/SECURITY.md).
