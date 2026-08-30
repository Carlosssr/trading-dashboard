import 'server-only'
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type Transaction as PlaidTransaction,
} from 'plaid'
import type { AccountType, ProviderName } from '@prisma/client'
import { env } from '@/lib/env'
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

/**
 * Plaid adapter.
 *
 * Everything Plaid-specific stops here: its account taxonomy, its sign
 * convention, its error codes, its webhook envelope. Callers see only the
 * normalized shapes in ../types.
 */

function client(): PlaidApi {
  const basePath = PlaidEnvironments[env.plaid.environment]
  if (!basePath) {
    throw new ProviderError(`Unknown PLAID_ENV: ${env.plaid.environment}`)
  }

  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': env.plaid.clientId,
          'PLAID-SECRET': env.plaid.secret,
        },
      },
    }),
  )
}

/**
 * Plaid's (type, subtype) pair mapped onto our account taxonomy. Subtype is
 * checked first because it is the more specific signal — `credit`/`credit card`
 * and `loan`/`mortgage` both need the subtype to land correctly.
 */
function mapAccountType(type: string, subtype: string | null | undefined): AccountType {
  const sub = (subtype ?? '').toLowerCase()

  switch (sub) {
    case 'checking':
      return 'CHECKING'
    case 'savings':
      return 'SAVINGS'
    case 'money market':
      return 'MONEY_MARKET'
    case 'cd':
      return 'CD'
    case 'credit card':
      return 'CREDIT_CARD'
    case 'line of credit':
    case 'overdraft':
      return 'LINE_OF_CREDIT'
    case 'auto':
      return 'AUTO_LOAN'
    case 'mortgage':
    case 'home equity':
      return 'MORTGAGE'
    case 'student':
      return 'STUDENT_LOAN'
    case 'business':
    case 'commercial':
      return 'BUSINESS_LOAN'
    case 'personal':
    case 'consumer':
      return 'PERSONAL_LOAN'
    case '401k':
    case '403b':
    case 'ira':
    case 'roth':
    case 'roth 401k':
    case 'pension':
    case 'retirement':
      return 'RETIREMENT'
  }

  switch (type.toLowerCase()) {
    case 'depository':
      return 'CHECKING'
    case 'credit':
      return 'CREDIT_CARD'
    case 'loan':
      return 'PERSONAL_LOAN'
    case 'investment':
    case 'brokerage':
      return 'INVESTMENT'
    default:
      return 'OTHER_ASSET'
  }
}

function normalizeAccount(account: AccountBase): ProviderAccount {
  const type = mapAccountType(String(account.type), account.subtype)
  const balances = account.balances

  return {
    providerAccountId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    mask: account.mask ?? null,
    type,
    subtype: account.subtype ?? null,
    currentBalance: (balances.current ?? 0).toFixed(2),
    availableBalance: balances.available !== null && balances.available !== undefined
      ? balances.available.toFixed(2)
      : null,
    creditLimit: balances.limit !== null && balances.limit !== undefined
      ? balances.limit.toFixed(2)
      : null,
    currency: balances.iso_currency_code ?? 'USD',
  }
}

/**
 * The single place the sign convention is flipped.
 *
 * Plaid reports a $12 coffee as amount = +12 (money leaving) and a paycheck as
 * amount = -2000. Our house convention is the opposite — positive is money in —
 * so every amount is negated exactly once, here.
 */
function normalizeTransaction(transaction: PlaidTransaction): ProviderTransaction {
  return {
    providerTransactionId: transaction.transaction_id,
    providerAccountId: transaction.account_id,
    postedAt: new Date(transaction.date),
    authorizedAt: transaction.authorized_date ? new Date(transaction.authorized_date) : null,
    amount: (-transaction.amount).toFixed(2),
    currency: transaction.iso_currency_code ?? 'USD',
    merchantName: transaction.merchant_name ?? null,
    rawName: transaction.name,
    categoryHint: transaction.personal_finance_category
      ? [transaction.personal_finance_category.primary, transaction.personal_finance_category.detailed]
      : (transaction.category ?? null),
    pending: transaction.pending,
  }
}

export class PlaidProvider implements AggregationProvider {
  readonly name: ProviderName = 'PLAID'

  async createLinkSession(input: { userId: string; workspaceId: string }): Promise<LinkSession> {
    try {
      const response = await client().linkTokenCreate({
        user: { client_user_id: input.userId },
        client_name: 'Financial Command Center',
        products: [Products.Transactions],
        // Requested as additional consent so liability detail (APR, minimum
        // payment, due date) and holdings arrive when the institution supports
        // them, without failing the link when it does not.
        optional_products: [Products.Liabilities, Products.Investments],
        country_codes: [CountryCode.Us],
        language: 'en',
        ...(env.plaid.webhookUrl ? { webhook: env.plaid.webhookUrl } : {}),
      })

      return {
        linkToken: response.data.link_token,
        expiration: new Date(response.data.expiration),
        provider: 'PLAID',
      }
    } catch (error) {
      throw toProviderError(error, 'Failed to create Plaid link token')
    }
  }

  async exchangePublicToken(input: { publicToken: string }): Promise<LinkedItem> {
    try {
      const exchange = await client().itemPublicTokenExchange({ public_token: input.publicToken })
      const accessToken = exchange.data.access_token

      const item = await client().itemGet({ access_token: accessToken })
      const institutionId = item.data.item.institution_id

      let institutionName = 'Connected Institution'
      let logoUrl: string | null = null
      let primaryColor: string | null = null
      let website: string | null = null

      if (institutionId) {
        const institution = await client().institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
          options: { include_optional_metadata: true },
        })
        institutionName = institution.data.institution.name
        logoUrl = institution.data.institution.logo ?? null
        primaryColor = institution.data.institution.primary_color ?? null
        website = institution.data.institution.url ?? null
      }

      return {
        providerItemId: exchange.data.item_id,
        accessToken,
        institution: {
          providerInstitutionId: institutionId ?? 'unknown',
          name: institutionName,
          logoUrl,
          primaryColor,
          website,
        },
      }
    } catch (error) {
      throw toProviderError(error, 'Failed to exchange Plaid public token')
    }
  }

  async fetchAccounts(item: ItemHandle): Promise<ProviderAccount[]> {
    try {
      const response = await client().accountsGet({ access_token: item.accessToken })
      return response.data.accounts.map(normalizeAccount)
    } catch (error) {
      throw toProviderError(error, 'Failed to fetch Plaid accounts')
    }
  }

  /**
   * Walks Plaid's paginated delta sync to completion, so one call to this method
   * returns everything that changed since `cursor`.
   */
  async fetchTransactions(item: ItemHandle, cursor: string | null): Promise<TransactionPage> {
    const added: ProviderTransaction[] = []
    const modified: ProviderTransaction[] = []
    const removedIds: string[] = []

    let nextCursor = cursor ?? undefined
    let hasMore = true

    try {
      while (hasMore) {
        const response = await client().transactionsSync({
          access_token: item.accessToken,
          ...(nextCursor ? { cursor: nextCursor } : {}),
          count: 500,
        })

        added.push(...response.data.added.map(normalizeTransaction))
        modified.push(...response.data.modified.map(normalizeTransaction))
        removedIds.push(...response.data.removed.map((r) => r.transaction_id))

        nextCursor = response.data.next_cursor
        hasMore = response.data.has_more
      }

      return { added, modified, removedIds, cursor: nextCursor ?? '', hasMore: false }
    } catch (error) {
      throw toProviderError(error, 'Failed to sync Plaid transactions')
    }
  }

  /**
   * Liabilities are an optional product. An institution that does not support it
   * returns an error rather than an empty list, and that is not a sync failure —
   * it just means APR and minimum payment stay unknown.
   */
  async fetchLiabilities(item: ItemHandle): Promise<ProviderLiability[]> {
    try {
      const response = await client().liabilitiesGet({ access_token: item.accessToken })
      const liabilities = response.data.liabilities
      const results: ProviderLiability[] = []

      for (const card of liabilities.credit ?? []) {
        if (!card.account_id) continue
        results.push({
          providerAccountId: card.account_id,
          apr: card.aprs?.[0]?.apr_percentage != null ? card.aprs[0].apr_percentage / 100 : null,
          minimumPayment: card.minimum_payment_amount?.toFixed(2) ?? null,
          nextPaymentDueAt: card.next_payment_due_date ? new Date(card.next_payment_due_date) : null,
          lastStatementBalance: card.last_statement_balance?.toFixed(2) ?? null,
          lastStatementAt: card.last_statement_issue_date
            ? new Date(card.last_statement_issue_date)
            : null,
        })
      }

      for (const mortgage of liabilities.mortgage ?? []) {
        results.push({
          providerAccountId: mortgage.account_id,
          apr: mortgage.interest_rate?.percentage != null
            ? mortgage.interest_rate.percentage / 100
            : null,
          minimumPayment: mortgage.next_monthly_payment?.toFixed(2) ?? null,
          nextPaymentDueAt: mortgage.next_payment_due_date
            ? new Date(mortgage.next_payment_due_date)
            : null,
          originalPrincipal: mortgage.origination_principal_amount?.toFixed(2) ?? null,
          maturityDate: mortgage.maturity_date ? new Date(mortgage.maturity_date) : null,
        })
      }

      for (const student of liabilities.student ?? []) {
        if (!student.account_id) continue
        results.push({
          providerAccountId: student.account_id,
          apr: student.interest_rate_percentage / 100,
          minimumPayment: student.minimum_payment_amount?.toFixed(2) ?? null,
          nextPaymentDueAt: student.next_payment_due_date
            ? new Date(student.next_payment_due_date)
            : null,
          originalPrincipal: student.origination_principal_amount?.toFixed(2) ?? null,
        })
      }

      return results
    } catch {
      return []
    }
  }

  async fetchHoldings(item: ItemHandle): Promise<ProviderHolding[]> {
    try {
      const response = await client().investmentsHoldingsGet({ access_token: item.accessToken })
      const securities = new Map(response.data.securities.map((s) => [s.security_id, s]))
      const asOf = new Date()

      return response.data.holdings.map((holding) => {
        const security = securities.get(holding.security_id)
        return {
          providerAccountId: holding.account_id,
          securityName: security?.name ?? security?.ticker_symbol ?? 'Unknown security',
          ticker: security?.ticker_symbol ?? null,
          quantity: holding.quantity.toFixed(8),
          costBasis: holding.cost_basis?.toFixed(2) ?? null,
          price: (holding.institution_price ?? 0).toFixed(6),
          value: (holding.institution_value ?? 0).toFixed(2),
          asOf,
        }
      })
    } catch {
      return []
    }
  }

  async removeItem(item: ItemHandle): Promise<void> {
    try {
      await client().itemRemove({ access_token: item.accessToken })
    } catch (error) {
      throw toProviderError(error, 'Failed to remove Plaid item')
    }
  }

  /**
   * Verification happens before the body is trusted. `plaid-verification` is a
   * JWT whose key is fetched from Plaid and whose body hash must match the
   * payload — an unsigned or stale webhook is dropped, never synced.
   */
  async parseWebhook(input: {
    body: string
    headers: Record<string, string>
  }): Promise<ProviderWebhookEvent | null> {
    const token = input.headers['plaid-verification']
    if (!token) return null

    const verified = await verifyWebhookSignature(token, input.body)
    if (!verified) return null

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(input.body) as Record<string, unknown>
    } catch {
      return null
    }

    const itemId = typeof payload.item_id === 'string' ? payload.item_id : undefined
    const webhookCode = String(payload.webhook_code ?? '')

    switch (webhookCode) {
      case 'SYNC_UPDATES_AVAILABLE':
      case 'DEFAULT_UPDATE':
      case 'INITIAL_UPDATE':
      case 'HISTORICAL_UPDATE':
        return { kind: 'TRANSACTIONS_UPDATED', providerItemId: itemId }
      case 'ITEM_LOGIN_REQUIRED':
        return { kind: 'ITEM_LOGIN_REQUIRED', providerItemId: itemId, status: 'LOGIN_REQUIRED' }
      case 'PENDING_EXPIRATION':
        return { kind: 'ITEM_ERROR', providerItemId: itemId, status: 'PENDING_EXPIRATION' }
      case 'ERROR':
        return {
          kind: 'ITEM_ERROR',
          providerItemId: itemId,
          status: 'ERROR',
          message: String((payload.error as { error_message?: string } | undefined)?.error_message ?? 'Item error'),
        }
      default:
        return { kind: 'UNKNOWN', providerItemId: itemId }
    }
  }
}

/**
 * Plaid signs webhooks with a per-item key served from their API. The JWT's
 * `request_body_sha256` claim must match the payload we received, which is what
 * stops a valid-but-replayed signature from being paired with a different body.
 */
async function verifyWebhookSignature(token: string, body: string): Promise<boolean> {
  const { createHash, createVerify } = await import('node:crypto')

  const [headerPart] = token.split('.')
  if (!headerPart) return false

  let header: { kid?: string; alg?: string }
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      kid?: string
      alg?: string
    }
  } catch {
    return false
  }

  if (header.alg !== 'ES256' || !header.kid) return false

  try {
    const keyResponse = await client().webhookVerificationKeyGet({ key_id: header.kid })
    const jwk = keyResponse.data.key
    if (!jwk.x || !jwk.y || !jwk.crv) return false

    const { createPublicKey } = await import('node:crypto')
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk',
    })

    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
    if (!encodedHeader || !encodedPayload || !encodedSignature) return false

    const verifier = createVerify('SHA256')
    verifier.update(`${encodedHeader}.${encodedPayload}`)
    const signatureValid = verifier.verify(
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSignature, 'base64url'),
    )
    if (!signatureValid) return false

    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      request_body_sha256?: string
      iat?: number
    }

    // Reject anything older than five minutes to bound replay.
    if (typeof claims.iat === 'number' && Date.now() / 1000 - claims.iat > 300) return false

    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')
    return claims.request_body_sha256 === bodyHash
  } catch {
    return false
  }
}

function toProviderError(error: unknown, fallback: string): ProviderError {
  const response = (error as { response?: { data?: { error_code?: string; error_message?: string } } })
    .response
  const code = response?.data?.error_code
  const message = response?.data?.error_message ?? fallback

  return new ProviderError(
    message,
    code,
    code === 'ITEM_LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : code ? 'ERROR' : undefined,
  )
}
