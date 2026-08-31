/**
 * End-to-end exercise of the write paths against a running server.
 *
 * Covers the flows that a page render cannot prove work: registration and
 * login, tenant isolation, the two-phase payment flow and its refusals,
 * category override with rule creation, recurring Add/Ignore, manual mark-paid,
 * entity reassignment, and sync idempotency.
 *
 *   node scripts/e2e.mjs
 */

import { request } from 'playwright'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

async function json(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const owner = await request.newContext({ baseURL: BASE })
const stranger = await request.newContext({ baseURL: BASE })

// --- Authentication ---------------------------------------------------------
section('Authentication')

const badLogin = await owner.post('/api/auth/login', {
  data: { email: 'demo@example.com', password: 'wrong-password' },
  failOnStatusCode: false,
})
const badBody = await json(badLogin)
check('a wrong password is rejected', badLogin.status() === 401)
check(
  'the rejection does not reveal whether the account exists',
  badBody?.error?.message === 'Incorrect email or password.',
  badBody?.error?.message,
)

const unknownLogin = await owner.post('/api/auth/login', {
  data: { email: 'nobody@example.com', password: 'wrong-password' },
  failOnStatusCode: false,
})
const unknownBody = await json(unknownLogin)
check(
  'an unknown address returns the identical message',
  unknownBody?.error?.message === badBody?.error?.message,
)

const weak = await owner.post('/api/auth/register', {
  data: { email: `weak-${Date.now()}@example.com`, name: 'Weak', password: 'short' },
  failOnStatusCode: false,
})
check('a weak password is refused', weak.status() === 401 || weak.status() === 422)

const anonymous = await request.newContext({ baseURL: BASE })
const guarded = await anonymous.get('/api/payments', { failOnStatusCode: false })
check('an unauthenticated request to a data endpoint is refused', guarded.status() === 401)

const login = await owner.post('/api/auth/login', {
  data: { email: 'demo@example.com', password: 'DemoPassword123!' },
  failOnStatusCode: false,
})
check('the demo account signs in', login.ok())

// A second, unrelated workspace, for the isolation checks.
const strangerEmail = `stranger-${Date.now()}@example.com`
const registered = await stranger.post('/api/auth/register', {
  data: { email: strangerEmail, name: 'Stranger', password: 'StrangerPass123!' },
  failOnStatusCode: false,
})
check('a new account can register', registered.ok(), String(registered.status()))

// --- Fixtures ---------------------------------------------------------------
const bills = await json(await owner.get('/api/bills'))
const payments = await json(await owner.get('/api/payments'))

const billWithFunding = bills?.bills?.find((bill) => bill.fundingAccountId)
const fundingAccountId = billWithFunding?.fundingAccountId

// --- Tenant isolation -------------------------------------------------------
section('Tenant isolation')

const strangerBills = await json(await stranger.get('/api/bills'))
check('a new workspace starts with no bills', (strangerBills?.bills?.length ?? -1) === 0)

if (fundingAccountId) {
  const crossTenant = await stranger.post('/api/payments', {
    data: {
      fundingAccountId,
      payeeName: 'Cross tenant probe',
      amount: '1.00',
      scheduledFor: new Date().toISOString().slice(0, 10),
    },
    failOnStatusCode: false,
  })
  check(
    "another workspace's account cannot be used as a funding source",
    crossTenant.status() === 404 || crossTenant.status() === 403,
    String(crossTenant.status()),
  )
}

// Cross-tenant foreign keys: scoping the query on the row being written is not
// enough when the client also supplies ids of *related* rows. Attaching another
// workspace's account to your own bill would otherwise leak its institution,
// nickname, and last four through the bill list's join.
const strangerEntities = await json(await stranger.get('/api/entities'))
const strangerEntityId = strangerEntities?.entities?.[0]?.id
check('a new workspace gets its default Personal entity', typeof strangerEntityId === 'string')

if (fundingAccountId && strangerEntityId) {
  // Uses the stranger's *own* entity, so entity validation passes and the only
  // thing that can reject this is the foreign-key ownership check.
  const foreignFk = await stranger.post('/api/bills', {
    data: {
      entityId: strangerEntityId,
      name: 'FK probe',
      payeeName: 'FK probe',
      expectedAmount: '1.00',
      cadence: 'MONTHLY',
      fundingAccountId,
    },
    failOnStatusCode: false,
  })
  check(
    "a bill cannot reference another workspace's funding account",
    foreignFk.status() === 404,
    String(foreignFk.status()),
  )

  const leaked = await json(await stranger.get('/api/bills'))
  check(
    'no bill in the other workspace exposes the foreign account',
    (leaked?.bills ?? []).every((bill) => bill.fundingAccountId !== fundingAccountId),
  )
}

// --- Payments ---------------------------------------------------------------
section('Payments')

if (fundingAccountId) {
  const draft = await owner.post('/api/payments', {
    data: {
      fundingAccountId,
      payeeName: 'E2E Payee',
      amount: '25.00',
      scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      memo: 'end-to-end test',
    },
    failOnStatusCode: false,
  })
  const draftBody = await json(draft)
  const confirmation = draftBody?.confirmation

  check('a payment draft is created', draft.ok(), String(draft.status()))
  check(
    'the draft returns a confirmation sentence naming amount and account',
    typeof confirmation?.sentence === 'string' &&
      confirmation.sentence.includes('$25.00') &&
      confirmation.sentence.startsWith("You're about to pay"),
    confirmation?.sentence,
  )
  check('the draft returns a single-use confirmation token', typeof confirmation?.token === 'string')

  const paymentsAfterDraft = await json(await owner.get('/api/payments'))
  const drafted = paymentsAfterDraft?.payments?.find((p) => p.id === confirmation?.paymentId)
  check(
    'a drafted payment is not yet submitted',
    drafted?.status === 'PENDING_CONFIRMATION',
    drafted?.status,
  )

  const wrongToken = await owner.post(`/api/payments/${confirmation.paymentId}/confirm`, {
    data: { token: 'not-the-right-token' },
    failOnStatusCode: false,
  })
  check('confirming with a wrong token is refused', wrongToken.status() === 422, String(wrongToken.status()))

  const confirmed = await owner.post(`/api/payments/${confirmation.paymentId}/confirm`, {
    data: { token: confirmation.token },
    failOnStatusCode: false,
  })
  const confirmedBody = await json(confirmed)
  check('confirming with the right token succeeds', confirmed.ok(), String(confirmed.status()))
  check(
    'a confirmed payment is scheduled or submitted, never completed',
    ['SCHEDULED', 'SUBMITTED'].includes(confirmedBody?.payment?.status),
    confirmedBody?.payment?.status,
  )

  const replay = await owner.post(`/api/payments/${confirmation.paymentId}/confirm`, {
    data: { token: confirmation.token },
    failOnStatusCode: false,
  })
  check('the confirmation token cannot be replayed', replay.status() === 409, String(replay.status()))

  const zero = await owner.post('/api/payments', {
    data: {
      fundingAccountId,
      payeeName: 'Zero',
      amount: '0.00',
      scheduledFor: new Date().toISOString().slice(0, 10),
    },
    failOnStatusCode: false,
  })
  check('a zero-amount payment is refused', zero.status() === 422, String(zero.status()))
} else {
  check('a bill with a funding account exists to test payments against', false)
}

// --- Transactions, categories, and rules ------------------------------------
section('Transactions, categories, and rules')

const listed = await json(await owner.get('/api/transactions?limit=50'))
check('transactions can be listed', (listed?.transactions?.length ?? 0) > 0)

const strangerTx = await json(await stranger.get('/api/transactions?limit=5'))
check(
  'a new workspace sees none of the demo transactions',
  (strangerTx?.transactions?.length ?? -1) === 0,
)

const target = listed?.transactions?.find((t) => t.merchantName && !t.isTransfer)
if (target) {
  const crossTenantEdit = await stranger.patch(`/api/transactions/${target.id}`, {
    data: { notes: 'probe' },
    failOnStatusCode: false,
  })
  check(
    "another workspace cannot edit this workspace's transaction",
    !crossTenantEdit.ok(),
    String(crossTenantEdit.status()),
  )

  // Pick a category different from the one it already has.
  const otherCategoryTx = listed.transactions.find(
    (t) => t.categoryId && t.categoryId !== target.categoryId,
  )

  if (otherCategoryTx) {
    const recategorized = await owner.patch(`/api/transactions/${target.id}`, {
      data: { categoryId: otherCategoryTx.categoryId, applyToFuture: true, applyToPast: true },
      failOnStatusCode: false,
    })
    const recategorizedBody = await json(recategorized)

    check('a category override succeeds', recategorized.ok(), String(recategorized.status()))
    check('answering "apply to future" creates a rule', recategorizedBody?.ruleCreated === true)
    check(
      'the rule backfills matching history',
      (recategorizedBody?.backfilled ?? 0) >= 1,
      `backfilled ${recategorizedBody?.backfilled}`,
    )

    const after = await json(await owner.get(`/api/transactions?limit=200`))
    const updated = after?.transactions?.find((t) => t.id === target.id)
    check(
      'the transaction now carries the chosen category',
      updated?.categoryId === otherCategoryTx.categoryId,
      updated?.categoryName,
    )
  }
} else {
  check('a transaction is available to recategorize', false)
}

// --- Recurring detection ----------------------------------------------------
section('Recurring detection')

const series = await json(await owner.get('/api/recurring'))
check('detected series are listed', (series?.series?.length ?? 0) > 0)
check(
  'confirmed series are linked to bills',
  (series?.series ?? []).some((item) => item.status === 'CONFIRMED' && item.billCount > 0),
)

const proposal = (series?.series ?? []).find((item) => item.status === 'DETECTED')
if (proposal) {
  const ignored = await owner.patch(`/api/recurring/${proposal.id}`, {
    data: { action: 'ignore' },
    failOnStatusCode: false,
  })
  check('a proposal can be ignored', ignored.ok(), String(ignored.status()))

  const afterIgnore = await json(await owner.get('/api/recurring?status=IGNORED'))
  check(
    'an ignored proposal is recorded as ignored',
    (afterIgnore?.series ?? []).some((item) => item.id === proposal.id),
  )
}

// --- Bills ------------------------------------------------------------------
section('Bills')

const occurrenceProbe = bills?.bills?.[0]
check('the demo workspace has bills', (bills?.bills?.length ?? 0) > 0)

const badBill = await owner.post('/api/bills', {
  data: { entityId: 'not-a-real-entity', name: 'x', payeeName: 'x', expectedAmount: '1.00', cadence: 'MONTHLY' },
  failOnStatusCode: false,
})
check('creating a bill against an unknown entity fails', !badBill.ok(), String(badBill.status()))

const badAmount = await owner.post('/api/bills', {
  data: {
    entityId: occurrenceProbe?.entityId ?? 'x',
    name: 'Bad amount',
    payeeName: 'Bad',
    expectedAmount: 'twenty dollars',
    cadence: 'MONTHLY',
  },
  failOnStatusCode: false,
})
check('a malformed amount is rejected by validation', badAmount.status() === 422, String(badAmount.status()))

const billsPage = await owner.get('/bills', { failOnStatusCode: false })
check('the bill pay page renders', billsPage.ok())

// --- Entity reassignment ----------------------------------------------------
section('Entity reassignment')

const txForMove = (await json(await owner.get('/api/transactions?limit=1')))?.transactions?.[0]
if (txForMove) {
  const businessEntity = bills?.bills?.find((bill) => bill.ledger === 'BUSINESS')?.entityId
  const personalEntity = bills?.bills?.find((bill) => bill.ledger === 'PERSONAL')?.entityId
  const destination = txForMove.ledger === 'BUSINESS' ? personalEntity : businessEntity

  if (destination) {
    const moved = await owner.patch(`/api/accounts/${txForMove.accountId}`, {
      data: { entityId: destination },
      failOnStatusCode: false,
    })
    const movedBody = await json(moved)
    check('an account can be reassigned to another entity', moved.ok(), String(moved.status()))
    check(
      'reassignment moves the account transactions with it',
      (movedBody?.transactionsMoved ?? 0) > 0,
      `moved ${movedBody?.transactionsMoved}`,
    )

    const after = await json(await owner.get(`/api/transactions?accountId=${txForMove.accountId}&limit=5`))
    const movedTx = after?.transactions?.[0]
    check(
      'the moved transactions carry the destination entity',
      movedTx?.entityId === destination,
      movedTx?.entityName,
    )

    // Put it back so the demo data stays coherent for later runs.
    await owner.patch(`/api/accounts/${txForMove.accountId}`, {
      data: { entityId: txForMove.entityId },
      failOnStatusCode: false,
    })
  }
}

// --- Sync idempotency -------------------------------------------------------
section('Sync')

const firstSync = await owner.post('/api/sync', { failOnStatusCode: false, timeout: 120_000 })
const firstBody = await json(firstSync)
check('a manual sync succeeds', firstSync.ok(), String(firstSync.status()))

const secondSync = await owner.post('/api/sync', { failOnStatusCode: false, timeout: 120_000 })
const secondBody = await json(secondSync)
const addedAgain = (secondBody?.results ?? []).reduce((total, r) => total + (r.transactionsAdded ?? 0), 0)
check('re-syncing adds no duplicate transactions', addedAgain === 0, `added ${addedAgain}`)
check(
  'no sync reported an error',
  (firstBody?.results ?? []).every((r) => !r.error) && (secondBody?.results ?? []).every((r) => !r.error),
)

await owner.dispose()
await stranger.dispose()
await anonymous.dispose()

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exitCode = failed === 0 ? 0 : 1
