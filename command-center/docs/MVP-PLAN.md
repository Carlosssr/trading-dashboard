# MVP implementation plan

The brief's rule is explicit: do not build every feature at once. The phases below
are built in order, and each one leaves the application in a working, runnable state.

The priority for the first version is **working account connections, accurate
balances, transaction synchronization, and a dashboard worth looking at** — not
feature breadth.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Authentication — register, login, sessions, MFA, RBAC, audit log | Built |
| 2 | Financial institution connection — provider abstraction, link flow, encrypted tokens | Built |
| 3 | Account synchronization — balances, liabilities, daily snapshots | Built |
| 4 | Transaction synchronization — cursor-based delta, idempotent upserts | Built |
| 5 | Personal/business classification — entities, ledgers, merchant rules | Built |
| 6 | Dashboard — net worth, cash position, debt, upcoming, recurring | Built |
| 7 | Credit cards and debt | Built |
| 8 | Recurring bills and the Bill Pay center | Built |
| 9 | Business P&L | Built |
| 10 | Real estate | Built |
| 11 | Insights | Built |
| 12 | Security hardening and production deployment | Partial — see [SECURITY.md](./SECURITY.md#known-gaps-for-production-hardening-phase-12) |

## What each phase delivered

**Phase 1 — Authentication.** scrypt password hashing, opaque hashed session
tokens, TOTP MFA with backup codes, five-role RBAC, and an append-only audit log.
Registration bootstraps a workspace, the default `Personal` entity, and the system
category tree.

**Phase 2 — Connection.** `AggregationProvider` interface with two adapters: Plaid
and a deterministic demo provider. Link tokens are created server-side; the
`public_token` is exchanged server-side; the resulting access token is sealed with
AES-256-GCM before it touches the database.

**Phase 3 — Account sync.** Accounts upsert by `(provider, providerAccountId)`.
Liability data (APR, minimum payment, statement balance, next due date) merges onto
the same rows. One `AccountBalanceSnapshot` per account per day feeds the net-worth
trend.

**Phase 4 — Transaction sync.** Cursor-based delta sync with idempotent upserts by
`(provider, providerTransactionId)`, sign normalized to *positive = money in*, then
the post-processing pipeline: transfer pairing → merchant rules → auto-categorization
→ recurrence detection → bill matching.

**Phase 5 — Classification.** Entities own everything; `ledger` is denormalized for
fast filtering and kept consistent on write. Changing a transaction's category
offers to create a `MerchantRule` that applies to future transactions from the same
merchant, and can backfill history.

**Phase 6 — Dashboard.** Total financial position (assets, liabilities, personal /
business / combined net worth), cash position with month and YTD flow, the debt
table, upcoming payments bucketed 3-day / week / month, and recurring expense totals.
The `All | Personal | Business` toggle, entity filter, and period filter are shared
across every page.

**Phase 7 — Credit cards and debt.** Per-card utilization, available credit,
statement balance, due date, and APR, plus portfolio-level totals: total debt,
monthly debt service, weighted-average APR, aggregate utilization, and
debt-to-income when income data exists.

**Phase 8 — Bills and Bill Pay.** Detection proposals with Add / Ignore / Edit, a
month calendar, status indicators (due soon / upcoming / paid / autopay / overdue),
the two-phase payment flow with an explicit confirmation sentence, cash-reserve
warnings, and payment history.

**Phase 9 — Business P&L.** Revenue − operating expenses = net operating income, per
entity, filterable by month/quarter/year and by category, with margin, burn, and cash
balance per entity.

**Phase 10 — Real estate.** Per-property value, mortgage balance, rate, payment,
taxes, insurance, rent, expenses, equity, and monthly cash flow, with manual
valuations and an append-only valuation history ready for an automated source.

**Phase 11 — Insights.** A deterministic rules engine over the same computed
figures: spending increases, unusual transactions, high utilization, upcoming large
payments, subscription increases, cash-flow strain, excess cash, high-interest debt,
and business expense and profitability trends. Plain language, no recommendations.

## Running it

```bash
cd command-center
cp .env.example .env          # then fill in the generated secrets
npm install
npm run db:migrate            # creates the schema
npm run db:seed               # demo workspace with realistic data
npm run dev
```

`AGGREGATION_PROVIDER=demo` (the default) runs the whole application, including the
link flow and sync, without Plaid credentials. Set it to `plaid` and supply
`PLAID_CLIENT_ID` / `PLAID_SECRET` to connect real institutions.

The seed creates `demo@example.com` / `DemoPassword123!` with four entities
(Personal, two LLCs, a rental property), fifteen accounts across every account type,
a year of transactions, bills, properties, and payment history.

## Deliberate MVP limitations

- **Payment initiation is provider-gated.** The `Payment` state machine, confirmation
  flow, cash-reserve checks, and audit trail are complete, but no real money-movement
  provider is wired up. The demo provider simulates confirmations. Connecting a real
  one means implementing `PaymentProvider` — the interface is defined and the call
  sites are in place.
- **Investments are positions only.** No performance attribution, cost-basis lots, or
  tax reporting.
- **Property values are manual.** `PropertyValuation.source` and the append-only
  history exist so an AVM can be added without a migration.
- **Recurrence detection needs history.** Confidence is low until a series has three
  or more occurrences; proposals are surfaced, never auto-applied.
