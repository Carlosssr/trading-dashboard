# Data model

The authoritative definition is [`prisma/schema.prisma`](../prisma/schema.prisma).
This document explains the shape and the decisions behind it.

## Tenancy

`Workspace` is the tenant boundary. Every financial row carries `workspaceId`, and
every service query filters on it. `Membership` joins users to workspaces with a
role, which is what makes role-based access real rather than aspirational.

```
User ──< Membership >── Workspace ──< Entity ──< Account ──< Transaction
```

A single user with one workspace is the common case; the model supports a
bookkeeper or spouse being added later with a restricted role without a migration.

## Identity & access

| Model | Purpose |
| --- | --- |
| `User` | Email, scrypt password hash, MFA state, encrypted TOTP secret. |
| `Membership` | `(userId, workspaceId, role)`. Roles: `OWNER`, `ADMIN`, `MEMBER`, `ACCOUNTANT`, `VIEWER`. |
| `Session` | Opaque token stored as a SHA-256 hash, with expiry, idle timeout, IP/UA, revocation, and an `mfaSatisfied` flag. |
| `BackupCode` | Hashed single-use MFA recovery codes. |
| `AuditLog` | Append-only record of security- and money-relevant actions. |

Passwords, TOTP secrets, and session tokens are never stored in a form that can be
replayed: hashes for the first and last, ciphertext for the second.

## Entities — the separation boundary

```prisma
model Entity {
  id             String     @id @default(cuid())
  workspaceId    String
  name           String     // "Personal", "LLC #1", "Rental Property #1"
  kind           EntityKind // PERSONAL | LLC | S_CORP | C_CORP | PARTNERSHIP | TRUST | RENTAL_PROPERTY
  ledger         Ledger     // PERSONAL | BUSINESS  — the hard separation
  minCashReserve Decimal?   @db.Decimal(18, 2)
  ...
}
```

`ledger` is the field that keeps personal and business accounting apart. It is
denormalized down onto `Account`, `Transaction`, `Bill`, `Payment`, and `Property`
so that every dashboard aggregate filters an indexed local column instead of
joining to `Entity`. `Account.ledger` must equal its entity's ledger; services
enforce this on write and rewrite descendants when an account changes entity.

`kind` is descriptive (what sort of legal entity this is); `ledger` is structural
(which set of books it belongs to). A `RENTAL_PROPERTY` entity is normally on the
`BUSINESS` ledger, but the two fields stay independent so an owner-occupied
property held in a trust can sit on the personal ledger.

## Aggregation

| Model | Notes |
| --- | --- |
| `Institution` | Provider-agnostic institution record (name, logo, brand color). |
| `ProviderItem` | One linked login at one institution. Holds the **encrypted** access token (`ciphertext`, `iv`, `authTag`, `keyVersion`), the transaction sync `cursor`, status, and last error. |

`ProviderItem` is the only place a provider credential exists, it is encrypted at
rest, and it is never selected into any payload that reaches a client component.

## Accounts

`Account` carries everything the brief asks to see for a connected account:
institution name, account name, type, `mask` (last four), current and available
balance, credit limit, `apr`, `minimumPayment`, `nextPaymentDueAt`,
`lastStatementBalance`, plus the classification fields (`entityId`, `ledger`,
`classification`).

`classification` is the account **owner/category** the brief specifies —
`PERSONAL`, `BUSINESS`, `INVESTMENT`, `REAL_ESTATE`. It is separate from `ledger`
because an investment or property account still has to belong to one set of books:
a rental property is `classification: REAL_ESTATE` on the `BUSINESS` ledger.

`AccountType` covers the full list: `CHECKING`, `SAVINGS`, `MONEY_MARKET`, `CD`,
`CREDIT_CARD`, `LINE_OF_CREDIT`, `AUTO_LOAN`, `MORTGAGE`, `STUDENT_LOAN`,
`PERSONAL_LOAN`, `BUSINESS_LOAN`, `INVESTMENT`, `RETIREMENT`, `PROPERTY`,
`VEHICLE`, `OTHER_ASSET`, `OTHER_LIABILITY`.

Whether a type is an asset or a liability is **not** a column — it is a pure
function in `lib/finance/account-kind.ts`, so there is exactly one definition and
net worth cannot disagree with the debt page.

`AccountBalanceSnapshot` stores one row per account per day. It is what makes the
net-worth trend chart possible without recomputing history from transactions.

## Transactions

`Transaction` stores date, merchant, amount, account, ledger/entity, category and
subcategory, recurring linkage, and notes — the fields the brief lists — plus
`pending`, `isTransfer`/`transferPairId`, and `excludeFromReports`.

**Sign convention: positive is money into the account.** Income and refunds are
positive; spending and payments are negative. Provider adapters normalize to this at
the boundary. Every function in `lib/finance` assumes it.

Internal transfers (a card payment moving from checking to the card) are detected
and paired. Paired transfers are excluded from income and expense totals so that
paying a credit card does not read as $2,000 of spending plus $2,000 of income.

`Category` is a two-level tree (`parentId`) grouped as `INCOME`, `EXPENSE`,
`TRANSFER`, or `DEBT_PAYMENT`. System categories are seeded and cannot be deleted;
users add their own.

`MerchantRule` is the single mechanism behind both "apply this category to future
transactions from this merchant" and the Bill Rules feature. One rule can set
category, entity, ledger, recurrence cadence, and default funding account, which is
exactly the `State Farm → Insurance → Personal → Monthly → Personal Checking`
example from the brief.

## Recurring, bills, and payments

Three models, deliberately distinct, because the brief requires that *tracking a
bill* and *initiating a payment* never be confused:

- **`RecurringSeries`** — what the detector found in transaction history. Carries a
  cadence, average amount, next expected date, a confidence score, and a status of
  `DETECTED` / `CONFIRMED` / `IGNORED`. A `DETECTED` series is a proposal shown with
  Add / Ignore / Edit; nothing else in the app acts on it until it is confirmed.
- **`Bill`** and **`BillOccurrence`** — the user's intent to pay something on a
  schedule, and the individual dated instances of it. Occurrence status is
  `SCHEDULED` / `DUE` / `PAID` / `OVERDUE` / `SKIPPED`. An occurrence becomes `PAID`
  only when a matching transaction is found, when a payment is confirmed complete by
  the provider, or when the user explicitly marks it paid.
- **`Payment`** — an actual outbound money movement. Its status machine is
  `DRAFT → PENDING_CONFIRMATION → SCHEDULED → SUBMITTED → PROCESSING → COMPLETED`,
  with `FAILED` and `CANCELLED` terminals. **A payment can only reach `COMPLETED`
  from a provider confirmation**, never from a UI action. Every transition writes an
  audit log row.

`CashReserveRule` holds the minimum-cash thresholds (personal, business, or a
specific entity) that the payment flow checks before scheduling.

## Real estate and investments

`Property` holds name, address, type, purchase price, current `estimatedValue` with
its `valuationSource` and `valuationAsOf`, an optional link to the mortgage
`Account`, and the monthly figures (rent, tax, insurance, HOA, other). Equity and
cash flow are computed, never stored — see `lib/finance/real-estate.ts`.

`PropertyValuation` is an append-only valuation history. Values are `MANUAL` today;
the column exists so an automated valuation source can start writing rows without a
schema change.

`Holding` keeps investment positions light for the MVP: security, ticker, quantity,
cost basis, price, value, as-of date.

## Insights

`Insight` rows are generated by a deterministic rules engine and stored so they can
be dismissed and so their history is visible. Each carries a `kind`, `severity`,
plain-language `title` and `body`, the scope it applies to, and the two numbers
being compared. Regeneration is idempotent per `(kind, scope, period)`.

## Indexing

The queries that must stay fast are: transactions for an account over a date range,
transactions for a ledger over a date range, upcoming bill occurrences, and
balance snapshots for a trend. The corresponding composite indexes are declared on
those models, along with the uniqueness constraints that make sync idempotent:
`(provider, providerAccountId)`, `(provider, providerTransactionId)`, and
`(accountId, asOf)` on snapshots.
