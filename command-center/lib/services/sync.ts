import 'server-only'
import { startOfDay } from 'date-fns'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getAggregationProvider } from '@/lib/providers'
import { ProviderError } from '@/lib/providers/types'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { defaultClassification, itemHandle } from './linking'
import { categorize, loadCategoryLookup, resolveCategoryId } from './categories'
import { applyMerchantRules } from './rules'
import { pairTransfers } from './transfers'
import { refreshRecurringSeries } from './recurring'
import { matchBillOccurrences } from './bills'
import { backfillSnapshots } from './snapshots'

/**
 * The synchronization pipeline.
 *
 * Every stage is idempotent: accounts upsert on (provider, providerAccountId),
 * transactions on (provider, providerTransactionId), snapshots on
 * (accountId, asOf). Re-running a sync changes nothing, which is what makes it
 * safe to trigger from the UI, a webhook, and a cron job all at once.
 */

export type SyncResult = {
  itemId: string
  institution: string
  accountsUpserted: number
  transactionsAdded: number
  transactionsModified: number
  transactionsRemoved: number
  liabilitiesUpdated: number
  holdingsUpserted: number
  transfersPaired: number
  rulesApplied: number
  seriesDetected: number
  billsMatched: number
  error?: string
}

export async function syncItem(input: {
  scope: WorkspaceScope
  itemId: string
  entityId?: string
  context?: RequestContext
}): Promise<SyncResult> {
  const item = await prisma.providerItem.findFirst({
    where: { id: input.itemId, workspaceId: input.scope.workspaceId },
    include: { institution: true },
  })
  if (!item) throw new Error('Linked institution not found')

  const provider = getAggregationProvider()
  const handle = itemHandle(item)

  const result: SyncResult = {
    itemId: item.id,
    institution: item.institution.name,
    accountsUpserted: 0,
    transactionsAdded: 0,
    transactionsModified: 0,
    transactionsRemoved: 0,
    liabilitiesUpdated: 0,
    holdingsUpserted: 0,
    transfersPaired: 0,
    rulesApplied: 0,
    seriesDetected: 0,
    billsMatched: 0,
  }

  // The entity every new account from this item is filed under. Falls back to
  // the workspace default so a sync can never orphan an account.
  const entity = await resolveEntity(input.scope.workspaceId, input.entityId)

  try {
    // --- Accounts --------------------------------------------------------
    const providerAccounts = await provider.fetchAccounts(handle)
    const today = startOfDay(new Date())

    for (const providerAccount of providerAccounts) {
      const account = await prisma.account.upsert({
        where: {
          provider_providerAccountId: {
            provider: provider.name,
            providerAccountId: providerAccount.providerAccountId,
          },
        },
        // A re-sync refreshes balances and provider metadata but never
        // overwrites the user's own classification decisions.
        update: {
          name: providerAccount.name,
          officialName: providerAccount.officialName ?? null,
          mask: providerAccount.mask ?? null,
          subtype: providerAccount.subtype ?? null,
          currentBalance: providerAccount.currentBalance,
          availableBalance: providerAccount.availableBalance ?? null,
          creditLimit: providerAccount.creditLimit ?? null,
          currency: providerAccount.currency,
          isDisconnected: false,
          providerItemId: item.id,
          institutionId: item.institutionId,
          lastSyncedAt: new Date(),
        },
        create: {
          workspaceId: input.scope.workspaceId,
          entityId: entity.id,
          institutionId: item.institutionId,
          providerItemId: item.id,
          provider: provider.name,
          providerAccountId: providerAccount.providerAccountId,
          institutionName: item.institution.name,
          name: providerAccount.name,
          officialName: providerAccount.officialName ?? null,
          mask: providerAccount.mask ?? null,
          type: providerAccount.type,
          subtype: providerAccount.subtype ?? null,
          classification: defaultClassification(providerAccount.type, entity.ledger),
          ledger: entity.ledger,
          currentBalance: providerAccount.currentBalance,
          availableBalance: providerAccount.availableBalance ?? null,
          creditLimit: providerAccount.creditLimit ?? null,
          currency: providerAccount.currency,
          lastSyncedAt: new Date(),
        },
      })

      result.accountsUpserted += 1

      // One snapshot per account per day feeds the net-worth trend.
      await prisma.accountBalanceSnapshot.upsert({
        where: { accountId_asOf: { accountId: account.id, asOf: today } },
        update: {
          current: providerAccount.currentBalance,
          available: providerAccount.availableBalance ?? null,
          limit: providerAccount.creditLimit ?? null,
        },
        create: {
          accountId: account.id,
          asOf: today,
          current: providerAccount.currentBalance,
          available: providerAccount.availableBalance ?? null,
          limit: providerAccount.creditLimit ?? null,
        },
      })
    }

    // --- Liabilities: APR, minimum payment, statement, due date ----------
    const liabilities = await provider.fetchLiabilities(handle)
    for (const liability of liabilities) {
      const updated = await prisma.account.updateMany({
        where: {
          workspaceId: input.scope.workspaceId,
          provider: provider.name,
          providerAccountId: liability.providerAccountId,
        },
        data: {
          ...(liability.apr !== null && liability.apr !== undefined ? { apr: liability.apr } : {}),
          ...(liability.minimumPayment ? { minimumPayment: liability.minimumPayment } : {}),
          ...(liability.nextPaymentDueAt ? { nextPaymentDueAt: liability.nextPaymentDueAt } : {}),
          ...(liability.lastStatementBalance
            ? { lastStatementBalance: liability.lastStatementBalance }
            : {}),
          ...(liability.lastStatementAt ? { lastStatementAt: liability.lastStatementAt } : {}),
          ...(liability.originalPrincipal ? { originalPrincipal: liability.originalPrincipal } : {}),
          ...(liability.maturityDate ? { maturityDate: liability.maturityDate } : {}),
        },
      })
      result.liabilitiesUpdated += updated.count
    }

    // --- Transactions: cursor-based delta --------------------------------
    const page = await provider.fetchTransactions(handle, item.transactionCursor)
    const accountsByProviderId = new Map(
      (
        await prisma.account.findMany({
          where: { workspaceId: input.scope.workspaceId, providerItemId: item.id },
          select: { id: true, providerAccountId: true, entityId: true, ledger: true },
        })
      ).map((account) => [account.providerAccountId ?? '', account]),
    )

    const categoryLookup = await loadCategoryLookup(input.scope.workspaceId)

    for (const providerTransaction of [...page.added, ...page.modified]) {
      const account = accountsByProviderId.get(providerTransaction.providerAccountId)
      if (!account) continue

      const amount = Number(providerTransaction.amount)
      const classification = categorize({
        merchantName: providerTransaction.merchantName ?? null,
        rawName: providerTransaction.rawName,
        amount,
        categoryHint: providerTransaction.categoryHint ?? null,
        ledger: account.ledger,
      })
      const categoryId = resolveCategoryId(categoryLookup, classification.categoryName)

      const data = {
        postedAt: providerTransaction.postedAt,
        authorizedAt: providerTransaction.authorizedAt ?? null,
        amount: providerTransaction.amount,
        currency: providerTransaction.currency,
        merchantName: providerTransaction.merchantName ?? null,
        rawName: providerTransaction.rawName,
        pending: providerTransaction.pending,
      } satisfies Prisma.TransactionUpdateInput

      await prisma.transaction.upsert({
        where: {
          provider_providerTransactionId: {
            provider: provider.name,
            providerTransactionId: providerTransaction.providerTransactionId,
          },
        },
        // A modified transaction refreshes provider-owned fields only. A
        // category the user corrected by hand is theirs, not the provider's.
        update: data,
        create: {
          ...data,
          workspaceId: input.scope.workspaceId,
          accountId: account.id,
          entityId: account.entityId,
          ledger: account.ledger,
          provider: provider.name,
          providerTransactionId: providerTransaction.providerTransactionId,
          categoryId,
        },
      })
    }

    result.transactionsAdded = page.added.length
    result.transactionsModified = page.modified.length

    if (page.removedIds.length > 0) {
      const removed = await prisma.transaction.deleteMany({
        where: {
          workspaceId: input.scope.workspaceId,
          provider: provider.name,
          providerTransactionId: { in: page.removedIds },
        },
      })
      result.transactionsRemoved = removed.count
    }

    // --- Holdings --------------------------------------------------------
    const holdings = await provider.fetchHoldings(handle)
    for (const holding of holdings) {
      const account = accountsByProviderId.get(holding.providerAccountId)
      if (!account) continue

      await prisma.holding.upsert({
        where: { accountId_securityName: { accountId: account.id, securityName: holding.securityName } },
        update: {
          ticker: holding.ticker ?? null,
          quantity: holding.quantity,
          costBasis: holding.costBasis ?? null,
          price: holding.price,
          value: holding.value,
          asOf: holding.asOf,
        },
        create: {
          workspaceId: input.scope.workspaceId,
          accountId: account.id,
          entityId: account.entityId,
          securityName: holding.securityName,
          ticker: holding.ticker ?? null,
          quantity: holding.quantity,
          costBasis: holding.costBasis ?? null,
          price: holding.price,
          value: holding.value,
          asOf: holding.asOf,
        },
      })
      result.holdingsUpserted += 1
    }

    await prisma.providerItem.update({
      where: { id: item.id },
      data: {
        transactionCursor: page.cursor,
        lastSyncedAt: new Date(),
        status: 'ACTIVE',
        lastError: null,
      },
    })

    // --- Post-processing, in dependency order ----------------------------
    // Providers give a current balance and a transaction list, never a balance
    // history. Reconstruct one for accounts that have none, so the net-worth
    // trend has something to draw on the very first sync.
    await backfillSnapshots(input.scope.workspaceId)

    result.transfersPaired = await pairTransfers(input.scope.workspaceId)
    result.rulesApplied = await applyMerchantRules(input.scope.workspaceId)
    result.seriesDetected = await refreshRecurringSeries(input.scope.workspaceId)
    result.billsMatched = await matchBillOccurrences(input.scope.workspaceId)

    await recordAuditSafe({
      action: AUDIT_ACTIONS.syncRan,
      workspaceId: input.scope.workspaceId,
      // Empty when the sync was triggered by a webhook rather than a person.
      userId: input.scope.userId || null,
      resourceType: 'provider_item',
      resourceId: item.id,
      metadata: { ...result },
      ...(input.context ? { context: input.context } : {}),
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'

    await prisma.providerItem.update({
      where: { id: item.id },
      data: {
        status: error instanceof ProviderError && error.itemStatus ? error.itemStatus : 'ERROR',
        lastError: message,
      },
    })

    await recordAuditSafe({
      action: AUDIT_ACTIONS.syncFailed,
      workspaceId: input.scope.workspaceId,
      // Empty when the sync was triggered by a webhook rather than a person.
      userId: input.scope.userId || null,
      resourceType: 'provider_item',
      resourceId: item.id,
      metadata: { message },
      ...(input.context ? { context: input.context } : {}),
    })

    return { ...result, error: message }
  }
}

export async function syncAll(input: {
  scope: WorkspaceScope
  context?: RequestContext
}): Promise<SyncResult[]> {
  const items = await prisma.providerItem.findMany({
    where: { workspaceId: input.scope.workspaceId, status: { not: 'REVOKED' } },
    select: { id: true },
  })

  const results: SyncResult[] = []
  // Sequential on purpose: the post-processing stages operate on the whole
  // workspace, so running items in parallel would have them racing each other.
  for (const item of items) {
    results.push(
      await syncItem({
        scope: input.scope,
        itemId: item.id,
        ...(input.context ? { context: input.context } : {}),
      }),
    )
  }
  return results
}

async function resolveEntity(workspaceId: string, entityId?: string) {
  if (entityId) {
    const entity = await prisma.entity.findFirst({ where: { id: entityId, workspaceId } })
    if (entity) return entity
  }

  const fallback = await prisma.entity.findFirst({
    where: { workspaceId, archivedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  if (!fallback) throw new Error('Workspace has no entity to file accounts under')
  return fallback
}
