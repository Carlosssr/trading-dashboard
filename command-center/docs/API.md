# API structure

Reads are served by Server Components calling `lib/services` directly. The HTTP API
below exists for client-side mutations and for the interactive parts of the UI
(filtering, inline edits, the link flow, payments).

Endpoints marked *(planned)* are described here but not yet implemented — the
service functions behind them exist and are used by the pages, but no route
handler is exposed. Everything else is built and covered by `npm run test:e2e`.

Conventions:

- JSON in, JSON out. Errors are `{ error: { code, message, details? } }`.
- Every request is authenticated by session cookie and scoped to the caller's
  workspace; the workspace is never accepted from the client.
- Bodies are validated with Zod schemas in `lib/validation`. A validation failure is
  `422` with field-level `details`.
- Status codes: `400` malformed, `401` unauthenticated, `403` role denied, `404`
  not found *or not in your workspace*, `409` state conflict, `422` validation,
  `429` rate limited.

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Creates user + workspace + seed entities and categories. Rate limited. |
| `POST` | `/api/auth/login` | Returns `{ mfaRequired: true }` without a session if MFA is enrolled. |
| `POST` | `/api/auth/mfa/challenge` | Completes login with a TOTP or backup code. |
| `POST` | `/api/auth/logout` | Revokes the current session. |
| `GET` | `/api/auth/session` *(planned)* | Current user, workspace, role, MFA state. |
| `POST` | `/api/auth/mfa/enroll` *(planned)* | Returns `otpauth://` URI + backup codes; requires a valid code to activate. |
| `POST` | `/api/auth/mfa/disable` *(planned)* | Requires current password. |
| `POST` | `/api/auth/password` *(planned)* | Changes password; revokes all other sessions. |

## Entities and settings

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`POST` | `/api/entities` *(planned)* | List / create. `ledger` is immutable after creation. |
| `PATCH`/`DELETE` | `/api/entities/{id}` *(planned)* | Delete is refused (`409`) while accounts reference it. |
| `GET`/`PUT` | `/api/settings/cash-reserves` *(planned)* | Minimum cash thresholds per scope. |
| `GET` | `/api/audit` *(planned)* | Paginated audit log. `ADMIN`+. |

## Institution linking

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/link/token` | Creates a provider link session. Returns `{ linkToken, expiration, provider }`. |
| `POST` | `/api/link/exchange` | Body `{ publicToken, institution, entityId }`. Exchanges, encrypts, stores, then runs a first sync. |
| `GET` | `/api/link/items` *(planned)* | Linked items with status and last sync time. Never returns tokens. |
| `DELETE` | `/api/link/items/{id}` | Revokes at the provider, then deletes local token. Accounts are retained and marked disconnected. |
| `POST` | `/api/webhooks/plaid` | Signature-verified. Unauthenticated by design; verification is the gate. |

## Sync

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/sync` | Body `{ itemId? }`. Full sync of one item or all. Returns per-stage counts. |
| `GET` | `/api/sync/status` *(planned)* | Per-item last sync, cursor age, and error state. |

## Accounts

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/accounts` *(planned — the accounts page reads through the service layer)* | Filters: `ledger`, `entityId`, `classification`, `type`, `includeClosed`. |
| `POST` | `/api/accounts` *(planned)* | Creates a **manual** account (property, vehicle, cash, private loan). |
| `PATCH` | `/api/accounts/{id}` | Entity/classification reassignment, manual balance, APR, credit limit, due date, nickname. Reassigning the entity rewrites `ledger` on the account and its transactions in one database transaction. |
| `DELETE` | `/api/accounts/{id}` *(planned)* | Manual accounts only. |

## Transactions

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/transactions` | Filters: `ledger`, `entityId`, `accountId`, `categoryId`, `from`, `to`, `q`, `min`, `max`, `recurringOnly`, `uncategorizedOnly`. Cursor paginated. |
| `PATCH` | `/api/transactions/{id}` | Category, entity, notes, `isTransfer`, `excludeFromReports`. Body may include `applyToFuture: true`, which additionally creates a `MerchantRule` — this is the "should this apply to future transactions from this merchant?" prompt. |
| `POST` | `/api/transactions/bulk` *(planned)* | Same fields across a set of ids. |
| `GET`/`POST` | `/api/rules` *(planned)* | Merchant rules (category, entity, ledger, cadence, funding account). |
| `POST` | `/api/rules/{id}/apply` *(planned)* | Backfills the rule across existing history. |

## Recurring and bills

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/recurring` | Detected and confirmed series with cadence, average amount, next expected date, confidence. |
| `PATCH` | `/api/recurring/{id}` | `status: CONFIRMED \| IGNORED`, or edit cadence/amount/category — the Add / Ignore / Edit actions. |
| `POST` | `/api/recurring/{id}/promote` *(folded into `PATCH /api/recurring/{id}` with `action: "add"`)* | Creates a `Bill` from a detected series. |
| `GET`/`POST` | `/api/bills` | List / create. |
| `PATCH` | `/api/bills` *(takes `billId` in the body)* | Includes `autopay` toggle. |
| `GET` | `/api/bills/calendar` *(planned — the page renders the calendar server-side)* | Occurrences for a month, shaped for the calendar grid. |
| `POST` | `/api/bills/occurrences/{id}` *(`action: "mark-paid" \| "skip" \| "reopen"`)* | Manual tracking only. Records actor and time. Does **not** create a `Payment`. |

## Payments — two-phase, always

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/payments` | Creates a `DRAFT`, runs the cash-reserve check, transitions to `PENDING_CONFIRMATION`, and returns `{ payment, confirmation: { sentence, warnings[], token } }`. **Moves no money.** |
| `POST` | `/api/payments/{id}/confirm` | Requires the single-use token and a payment in `PENDING_CONFIRMATION`. Only this call reaches the payment provider. |
| `POST` | `/api/payments/{id}/cancel` *(planned — the service exists)* | Allowed before `SUBMITTED`. |
| `GET` | `/api/payments` | History. Filters: `ledger`, `entityId`, `status`, `billId`, `from`, `to`. |

`COMPLETED` is set only by a provider confirmation. There is no endpoint that lets a
client declare a payment complete.

## Real estate, investments, reporting, insights

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`POST` | `/api/properties` *(planned)* | |
| `PATCH`/`DELETE` | `/api/properties/{id}` *(planned)* | |
| `POST` | `/api/properties/{id}/valuations` *(planned)* | Appends a valuation. `source: MANUAL` today; the automated-valuation path writes here later. |
| `GET` | `/api/investments` *(planned)* | Holdings grouped by account. |
| `GET` | `/api/reports/pnl` *(planned)* | Business P&L. Query: `entityId`, `period=month\|quarter\|year`, `from`, `to`, `groupBy=category`. |
| `GET` | `/api/reports/cash-flow` *(planned)* | Inflow/outflow series by ledger and period. |
| `GET` | `/api/reports/net-worth` *(planned)* | Trend from balance snapshots. |
| `GET` | `/api/insights` *(planned)* | Active insights, severity ordered. |
| `POST` | `/api/insights/{id}/dismiss` *(planned)* | |

## Shared filter contract

Every dashboard page accepts the same filter triple, parsed once by
`lib/validation/filters.ts` and reused by page and API alike:

```
?ledger=all|personal|business
&entityId=<id>            (optional; must belong to the workspace)
&period=this-month|last-month|ytd|last-12-months|custom
&from=YYYY-MM-DD&to=YYYY-MM-DD   (custom only)
```
