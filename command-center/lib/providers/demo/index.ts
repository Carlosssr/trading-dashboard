import { addDays, addMonths, differenceInCalendarDays, startOfDay, subMonths } from 'date-fns'
import type { Cadence, ProviderName } from '@prisma/client'
import type {
  AggregationProvider,
  ItemHandle,
  LinkSession,
  LinkedItem,
  ProviderAccount,
  ProviderHolding,
  ProviderLiability,
  ProviderTransaction,
  ProviderWebhookEvent,
  TransactionPage,
} from '../types'
import { ProviderError } from '../types'
import { DEMO_INSTITUTIONS, findInstitution, type AccountTemplate } from './catalog'

/**
 * Deterministic synthetic aggregation provider.
 *
 * It implements the same interface as the Plaid adapter and produces the same
 * normalized shapes, so the sync pipeline, categorizer, recurrence detector, and
 * every dashboard exercise real code paths with no provider credentials.
 *
 * Everything is derived from a seeded PRNG keyed on the item id, so re-syncing
 * returns identical data and the idempotent upserts can be verified.
 */

const MONTHS_OF_HISTORY = 12

/** mulberry32 — small, fast, and stable across runs. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function toAmount(value: number): string {
  return value.toFixed(2)
}

/** `demo-access-<institutionId>-<nonce>` — the nonce keeps two links distinct. */
function parseAccessToken(token: string): { institutionId: string; nonce: string } {
  const match = /^demo-access-(.+)-([a-z0-9]+)$/.exec(token)
  if (!match?.[1] || !match[2]) {
    throw new ProviderError(`Malformed demo access token: ${token}`)
  }
  return { institutionId: match[1], nonce: match[2] }
}

function accountId(nonce: string, key: string): string {
  return `demo-acct-${nonce}-${key}`
}

function cadenceStep(cadence: Cadence): number {
  switch (cadence) {
    case 'WEEKLY':
      return 7
    case 'BIWEEKLY':
      return 14
    case 'SEMIMONTHLY':
      return 15
    case 'QUARTERLY':
      return 91
    case 'SEMIANNUAL':
      return 182
    case 'ANNUAL':
      return 365
    default:
      return 30
  }
}

/**
 * Builds the full transaction history for one account: the recurring series on
 * their real cadences, plus discretionary spending scattered through each month.
 */
function generateTransactions(
  template: AccountTemplate,
  nonce: string,
  now: Date,
): ProviderTransaction[] {
  const random = createRandom(hashString(`${nonce}:${template.key}`))
  const transactions: ProviderTransaction[] = []
  const start = startOfDay(subMonths(now, MONTHS_OF_HISTORY))
  const acctId = accountId(nonce, template.key)

  let sequence = 0
  const push = (input: {
    postedAt: Date
    amount: number
    merchant: string
    rawName: string
  }) => {
    if (input.postedAt > now || input.postedAt < start) return
    sequence += 1
    transactions.push({
      providerTransactionId: `demo-txn-${nonce}-${template.key}-${sequence}`,
      providerAccountId: acctId,
      postedAt: startOfDay(input.postedAt),
      authorizedAt: startOfDay(input.postedAt),
      amount: toAmount(input.amount),
      currency: 'USD',
      merchantName: input.merchant,
      rawName: input.rawName,
      pending: false,
    })
  }

  for (const spec of template.recurring ?? []) {
    if (spec.cadence === 'MONTHLY' || spec.cadence === 'QUARTERLY' || spec.cadence === 'ANNUAL' || spec.cadence === 'SEMIANNUAL') {
      const monthStep = spec.cadence === 'MONTHLY' ? 1 : spec.cadence === 'QUARTERLY' ? 3 : spec.cadence === 'SEMIANNUAL' ? 6 : 12
      let cursor = new Date(start.getFullYear(), start.getMonth(), spec.dayOfMonth ?? 1)

      while (cursor <= now) {
        const jitter = spec.jitter ? 1 + (random() - 0.5) * 2 * spec.jitter : 1
        push({
          postedAt: cursor,
          amount: Number((spec.amount * jitter).toFixed(2)),
          merchant: spec.merchant,
          rawName: spec.rawName,
        })
        cursor = addMonths(cursor, monthStep)
      }
    } else {
      const step = cadenceStep(spec.cadence)
      let cursor = new Date(start)
      while (cursor <= now) {
        const jitter = spec.jitter ? 1 + (random() - 0.5) * 2 * spec.jitter : 1
        push({
          postedAt: cursor,
          amount: Number((spec.amount * jitter).toFixed(2)),
          merchant: spec.merchant,
          rawName: spec.rawName,
        })
        cursor = addDays(cursor, step)
      }
    }
  }

  for (const spec of template.discretionary ?? []) {
    const totalDays = differenceInCalendarDays(now, start)
    const occurrences = Math.round((spec.perMonth * totalDays) / 30)

    for (let i = 0; i < occurrences; i += 1) {
      const dayOffset = Math.floor(random() * totalDays)
      const amount = -(spec.min + random() * (spec.max - spec.min))
      push({
        postedAt: addDays(start, dayOffset),
        amount: Number(amount.toFixed(2)),
        merchant: spec.merchant,
        rawName: spec.rawName ?? spec.merchant.toUpperCase(),
      })
    }
  }

  return transactions.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime())
}

export class DemoProvider implements AggregationProvider {
  readonly name: ProviderName = 'DEMO'

  async createLinkSession(): Promise<LinkSession> {
    return {
      linkToken: `demo-link-${Math.random().toString(36).slice(2, 10)}`,
      expiration: addDays(new Date(), 1),
      provider: 'DEMO',
      availableInstitutions: DEMO_INSTITUTIONS.map((institution) => ({
        providerInstitutionId: institution.providerInstitutionId,
        name: institution.name,
        primaryColor: institution.primaryColor,
        website: institution.website,
      })),
    }
  }

  /** The demo public token carries the chosen institution: `demo-public-<institutionId>`. */
  async exchangePublicToken(input: { publicToken: string }): Promise<LinkedItem> {
    const institutionId = input.publicToken.replace(/^demo-public-/, '')
    const institution = findInstitution(institutionId)
    if (!institution) {
      throw new ProviderError(`Unknown demo institution: ${institutionId}`, 'INSTITUTION_NOT_FOUND')
    }

    const nonce = Math.random().toString(36).slice(2, 10)

    return {
      providerItemId: `demo-item-${institutionId}-${nonce}`,
      accessToken: `demo-access-${institutionId}-${nonce}`,
      institution: {
        providerInstitutionId: institution.providerInstitutionId,
        name: institution.name,
        primaryColor: institution.primaryColor,
        website: institution.website,
      },
    }
  }

  async fetchAccounts(item: ItemHandle): Promise<ProviderAccount[]> {
    const { institutionId, nonce } = parseAccessToken(item.accessToken)
    const institution = findInstitution(institutionId)
    if (!institution) throw new ProviderError(`Unknown demo institution: ${institutionId}`)

    return institution.accounts.map((template) => ({
      providerAccountId: accountId(nonce, template.key),
      name: template.name,
      officialName: template.officialName,
      mask: template.mask,
      type: template.type,
      subtype: template.subtype,
      currentBalance: toAmount(template.currentBalance),
      availableBalance:
        template.availableBalance !== undefined ? toAmount(template.availableBalance) : null,
      creditLimit: template.creditLimit !== undefined ? toAmount(template.creditLimit) : null,
      currency: 'USD',
    }))
  }

  /**
   * The first call returns the full history and a cursor. Subsequent calls
   * return an empty page, which is exactly how a real delta sync behaves when
   * nothing has changed — and it is what makes the idempotency of the upserts
   * observable.
   */
  async fetchTransactions(item: ItemHandle, cursor: string | null): Promise<TransactionPage> {
    const { institutionId, nonce } = parseAccessToken(item.accessToken)
    const institution = findInstitution(institutionId)
    if (!institution) throw new ProviderError(`Unknown demo institution: ${institutionId}`)

    if (cursor) {
      return { added: [], modified: [], removedIds: [], cursor, hasMore: false }
    }

    const now = new Date()
    const added = institution.accounts.flatMap((template) =>
      generateTransactions(template, nonce, now),
    )

    return {
      added,
      modified: [],
      removedIds: [],
      cursor: `demo-cursor-${Date.now()}`,
      hasMore: false,
    }
  }

  async fetchLiabilities(item: ItemHandle): Promise<ProviderLiability[]> {
    const { institutionId, nonce } = parseAccessToken(item.accessToken)
    const institution = findInstitution(institutionId)
    if (!institution) throw new ProviderError(`Unknown demo institution: ${institutionId}`)

    const now = new Date()

    return institution.accounts
      .filter((template) => template.apr !== undefined || template.minimumPayment !== undefined)
      .map((template) => ({
        providerAccountId: accountId(nonce, template.key),
        apr: template.apr ?? null,
        minimumPayment:
          template.minimumPayment !== undefined ? toAmount(template.minimumPayment) : null,
        nextPaymentDueAt:
          template.dueInDays !== undefined ? startOfDay(addDays(now, template.dueInDays)) : null,
        lastStatementBalance:
          template.statementBalance !== undefined ? toAmount(template.statementBalance) : null,
        lastStatementAt: template.dueInDays !== undefined ? addDays(now, template.dueInDays - 21) : null,
        originalPrincipal:
          template.originalPrincipal !== undefined ? toAmount(template.originalPrincipal) : null,
        maturityDate:
          template.maturityMonths !== undefined ? addMonths(now, template.maturityMonths) : null,
      }))
  }

  async fetchHoldings(item: ItemHandle): Promise<ProviderHolding[]> {
    const { institutionId, nonce } = parseAccessToken(item.accessToken)
    const institution = findInstitution(institutionId)
    if (!institution) throw new ProviderError(`Unknown demo institution: ${institutionId}`)

    const asOf = startOfDay(new Date())

    return institution.accounts.flatMap((template) =>
      (template.holdings ?? []).map((holding) => ({
        providerAccountId: accountId(nonce, template.key),
        securityName: holding.name,
        ticker: holding.ticker,
        quantity: holding.quantity.toFixed(8),
        costBasis: toAmount(holding.costBasis),
        price: holding.price.toFixed(6),
        value: toAmount(holding.quantity * holding.price),
        asOf,
      })),
    )
  }

  async removeItem(): Promise<void> {
    // Nothing to revoke: the demo provider holds no state outside the token.
  }

  async parseWebhook(): Promise<ProviderWebhookEvent | null> {
    return null
  }
}
