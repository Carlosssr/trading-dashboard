# Architecture

## What this system is

A single web application that consolidates personal and business finances into one
executive view, while keeping the two ledgers structurally separate. "Structurally
separate" is not a UI filter bolted on at the end — it is enforced in the data model
(see [Separation of ledgers](#separation-of-ledgers)).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript | Server Components let financial math run on the server, so raw account data and provider tokens never ship to the browser. |
| Styling | Tailwind CSS v4 | Utility-first, no runtime cost, fits a dense dashboard. |
| Database | PostgreSQL 16 | Numeric/decimal correctness, strong indexing for transaction queries. |
| ORM | Prisma 6 | Typed queries, migration history, `Decimal` mapping to Postgres `numeric`. |
| Charts | Recharts 3 | React-native composition, works with server-computed series. |
| Aggregation | Plaid, behind a provider interface | Swappable for MX/Finicity without touching application code. |
| Auth | First-party session layer (see [SECURITY.md](./SECURITY.md)) | Isolated behind `lib/auth`, replaceable with Auth.js or Clerk. |
| Hosting | Vercel + managed Postgres (Supabase/Neon) | Matches the serverless request model used throughout. |

## Layering

Code is organized so that business rules are testable without HTTP and without React.

```
app/                     Routes. Server Components render; Route Handlers mutate.
  (auth)/                Unauthenticated routes (login, register, MFA challenge).
  (dashboard)/           Authenticated shell + every dashboard page.
  api/                   Route Handlers — the write path and client-callable reads.

lib/
  auth/                  Sessions, password hashing, TOTP, RBAC guards.
  crypto/                AES-256-GCM envelope encryption for provider tokens.
  providers/             Aggregation provider interface + Plaid and demo adapters.
  services/              Application services. The only place that touches Prisma.
  finance/               Pure functions: net worth, APR weighting, utilization,
                         cash flow, amortization, recurrence detection, insights.
  validation/            Zod schemas shared by route handlers and forms.

components/              Presentational React. No data fetching, no Prisma.
prisma/                  Schema, migrations, seed.
```

Two rules keep the layering honest:

1. **`lib/finance` is pure.** Every function takes plain data and returns plain data.
   No Prisma import, no `async`, no clock reads (the current date is always a
   parameter). This is what makes the money math reviewable and testable.
2. **Only `lib/services` talks to Prisma.** Pages and route handlers call services;
   they never build queries themselves. That is what makes tenant scoping
   enforceable in one place instead of a hundred.

## Read path vs. write path

Reads happen inside Server Components, which call services directly — no HTTP
round-trip, no serialization of sensitive rows to the client:

```
page.tsx (server)  →  lib/services/dashboard.ts  →  Prisma  →  lib/finance/*  →  JSX
```

Writes happen through Route Handlers so the browser has a real API surface:

```
client component  →  POST /api/...  →  zod validation  →  requireSession/requireRole
                                    →  lib/services/*  →  Prisma  →  audit log
```

Both paths converge on the same service functions, so a rule enforced in a service
(tenant scoping, entity/ledger consistency, payment confirmation) cannot be bypassed
by picking a different entry point.

## Separation of ledgers

The requirement is that business and personal accounting are not commingled
underneath the hood. This is enforced by making the **entity** the mandatory owner
of every financial row.

- Every `Entity` declares a `ledger` of exactly `PERSONAL` or `BUSINESS`.
- Every `Account`, `Transaction`, `Bill`, `Payment`, and `Property` carries a
  required `entityId`, plus a denormalized `ledger` copied from that entity.
- Aggregate queries always group by `ledger` first. There is no query in the
  application that sums a personal and a business balance into a single figure
  except the explicitly-labelled *Combined* view, which sums two independently
  computed subtotals rather than one mixed query.

The denormalized `ledger` column is redundant with `entity.ledger` on purpose: it
lets every dashboard query filter on an indexed column of the same table instead of
joining, and a database check keeps the two in agreement. Moving an account between
entities rewrites `ledger` on its transactions in the same transaction block.

Entities are user-defined, so the required shape (`Personal`, `LLC #1`, `LLC #2`,
`Rental Property #1`) is just seed data, not schema.

## Provider abstraction

`lib/providers/types.ts` defines the interface every aggregation provider implements:

```ts
interface AggregationProvider {
  readonly name: ProviderName
  createLinkSession(input): Promise<LinkSession>       // Plaid: link_token
  exchangePublicToken(input): Promise<LinkedItem>      // public_token -> access_token
  fetchAccounts(item): Promise<ProviderAccount[]>
  fetchTransactions(item, cursor): Promise<TransactionPage>   // cursor-based delta
  fetchLiabilities(item): Promise<ProviderLiability[]>        // APR, min payment, due date
  fetchInvestments(item): Promise<ProviderHolding[]>
  removeItem(item): Promise<void>
  parseWebhook(payload): ProviderWebhookEvent | null
}
```

Adapters return **normalized** domain shapes, never provider-native ones. Two
normalizations matter most:

- **Account types.** Plaid's `type`/`subtype` pairs map to our `AccountType` enum in
  the adapter. The rest of the application never sees a Plaid subtype string.
- **Transaction sign.** We store `amount` with **positive = money into the account**.
  Plaid uses the opposite convention (positive = money leaving). The adapter flips
  the sign exactly once, at the boundary. Everything downstream can assume the
  house convention.

Two adapters ship: `plaid` (real) and `demo` (deterministic synthetic data). The
active one is selected by `AGGREGATION_PROVIDER`, which is what lets the dashboard be
run and reviewed without Plaid credentials.

## Synchronization

Sync is idempotent and cursor-based so it can be re-run safely.

1. **Accounts.** Full refresh per item. Balances are upserted by
   `(provider, providerAccountId)`, and a row is appended to
   `AccountBalanceSnapshot` once per account per day — that table is what the net
   worth trend chart reads.
2. **Transactions.** Plaid's `/transactions/sync` returns added/modified/removed
   plus a cursor, which we persist on the item. Rows upsert by
   `(provider, providerTransactionId)`, so replaying a page changes nothing.
3. **Liabilities.** APR, minimum payment, statement balance, and next due date are
   merged onto the existing account rows.
4. **Post-processing**, in order: transfer pairing → merchant rule application →
   automatic categorization → recurrence detection → bill occurrence matching →
   insight generation.

Sync is triggered three ways: on demand from the UI, by Plaid webhooks
(`/api/webhooks/plaid`), and by a scheduled job (Vercel Cron) that walks stale items.

## Money representation

All money is `Decimal(18,2)` in Postgres and `Prisma.Decimal` in TypeScript. It is
converted to `number` only at the render boundary, in formatting helpers. Rates
(APR, margins) are `Decimal(9,6)` stored as decimals, not percentages — `0.1899`,
not `18.99`. Percentages exist only in formatted output.

## What is deliberately not here

- **No LLM in the money path.** Categorization, recurrence detection, and insights
  are deterministic rules over transaction history. They are auditable and produce
  the same answer twice.
- **No financial advice.** The insights engine states observations and arithmetic
  ("recurring expenses are $420/month higher than three months ago") and never
  recommends an action.
- **No stored bank credentials.** See [SECURITY.md](./SECURITY.md).
