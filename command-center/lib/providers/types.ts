import type { AccountType, ItemStatus, ProviderName } from '@prisma/client'

/**
 * The aggregation-provider boundary.
 *
 * Every adapter returns these normalized shapes. Nothing downstream of this file
 * has ever seen a Plaid subtype string, a Plaid sign convention, or a Plaid
 * error code — which is what makes "replace Plaid with MX later" a matter of
 * writing one new adapter.
 *
 * Sign convention, enforced here: `amount` is POSITIVE when money enters the
 * account. Plaid uses the opposite; its adapter flips the sign exactly once.
 */

export type NormalizedInstitution = {
  providerInstitutionId: string
  name: string
  logoUrl?: string | null
  primaryColor?: string | null
  website?: string | null
}

export type LinkSession = {
  /** Opaque token handed to the provider's browser SDK. Not a credential. */
  linkToken: string
  expiration: Date
  provider: ProviderName
  /** Institutions the demo provider offers; real providers present their own picker. */
  availableInstitutions?: NormalizedInstitution[]
}

/** Result of exchanging a short-lived public token for a durable access token. */
export type LinkedItem = {
  providerItemId: string
  /** Sealed before storage, never returned to a client. */
  accessToken: string
  institution: NormalizedInstitution
}

export type ProviderAccount = {
  providerAccountId: string
  name: string
  officialName?: string | null
  /** Last four digits only. */
  mask?: string | null
  type: AccountType
  subtype?: string | null
  currentBalance: string
  availableBalance?: string | null
  creditLimit?: string | null
  currency: string
}

/** Liability detail, merged onto the matching account row. */
export type ProviderLiability = {
  providerAccountId: string
  /** Decimal rate: 0.1899 for 18.99%. */
  apr?: number | null
  minimumPayment?: string | null
  nextPaymentDueAt?: Date | null
  lastStatementBalance?: string | null
  lastStatementAt?: Date | null
  originalPrincipal?: string | null
  maturityDate?: Date | null
}

export type ProviderTransaction = {
  providerTransactionId: string
  providerAccountId: string
  postedAt: Date
  authorizedAt?: Date | null
  /** POSITIVE = money into the account. */
  amount: string
  currency: string
  merchantName?: string | null
  rawName: string
  /** Provider category hints, used only as a fallback by our own categorizer. */
  categoryHint?: string[] | null
  pending: boolean
}

export type TransactionPage = {
  added: ProviderTransaction[]
  modified: ProviderTransaction[]
  removedIds: string[]
  cursor: string
  hasMore: boolean
}

export type ProviderHolding = {
  providerAccountId: string
  securityName: string
  ticker?: string | null
  quantity: string
  costBasis?: string | null
  price: string
  value: string
  asOf: Date
}

export type ProviderWebhookEvent = {
  kind: 'TRANSACTIONS_UPDATED' | 'ITEM_ERROR' | 'ITEM_LOGIN_REQUIRED' | 'PAYMENT_STATUS' | 'UNKNOWN'
  providerItemId?: string
  status?: ItemStatus
  message?: string
}

/** Item handle passed to fetch methods. Carries the decrypted token in memory only. */
export type ItemHandle = {
  providerItemId: string
  accessToken: string
}

export interface AggregationProvider {
  readonly name: ProviderName

  /** Creates the session the browser SDK needs. Never returns a credential. */
  createLinkSession(input: { userId: string; workspaceId: string }): Promise<LinkSession>

  /** Exchanges a single-use public token for a durable access token, server-side. */
  exchangePublicToken(input: { publicToken: string }): Promise<LinkedItem>

  fetchAccounts(item: ItemHandle): Promise<ProviderAccount[]>

  /** Cursor-based delta sync. `cursor` is null on the first call. */
  fetchTransactions(item: ItemHandle, cursor: string | null): Promise<TransactionPage>

  fetchLiabilities(item: ItemHandle): Promise<ProviderLiability[]>

  fetchHoldings(item: ItemHandle): Promise<ProviderHolding[]>

  /** Revokes access at the provider. Called before local deletion. */
  removeItem(item: ItemHandle): Promise<void>

  /** Returns null when the payload fails verification. */
  parseWebhook(input: { body: string; headers: Record<string, string> }): Promise<ProviderWebhookEvent | null>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerCode?: string,
    readonly itemStatus?: ItemStatus,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
