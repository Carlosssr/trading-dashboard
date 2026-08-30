import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { createRule, backfillRule } from './rules'

/**
 * Transaction querying and manual overrides.
 *
 * The override path is where the brief's "should this apply to future
 * transactions from this merchant?" prompt is honoured: the client sends the
 * user's answer as `applyToFuture`, and a yes creates a real MerchantRule
 * rather than a one-off edit.
 */

export type TransactionFilters = {
  ledger?: 'PERSONAL' | 'BUSINESS'
  entityId?: string
  accountId?: string
  categoryId?: string
  from?: Date
  to?: Date
  search?: string
  uncategorizedOnly?: boolean
  recurringOnly?: boolean
  includeTransfers?: boolean
}

export type TransactionPage = {
  transactions: Awaited<ReturnType<typeof queryTransactions>>['transactions']
  nextCursor: string | null
  total: number
}

export async function queryTransactions(
  scope: WorkspaceScope,
  filters: TransactionFilters,
  pagination?: { cursor?: string; limit?: number },
) {
  const limit = Math.min(pagination?.limit ?? 100, 250)

  const where: Prisma.TransactionWhereInput = {
    workspaceId: scope.workspaceId,
    ...(filters.ledger ? { ledger: filters.ledger } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.recurringOnly ? { isRecurring: true } : {}),
    // Paired transfers are hidden by default: showing both halves makes the
    // list read as double the activity that actually happened.
    ...(filters.includeTransfers ? {} : { isTransfer: false }),
    ...(filters.uncategorizedOnly
      ? { OR: [{ categoryId: null }, { category: { name: 'Uncategorized' } }] }
      : {}),
    ...(filters.from || filters.to
      ? {
          postedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { merchantName: { contains: filters.search, mode: 'insensitive' } },
            { rawName: { contains: filters.search, mode: 'insensitive' } },
            { notes: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, group: true } },
        account: { select: { id: true, name: true, mask: true, institutionName: true, type: true } },
        entity: { select: { id: true, name: true, ledger: true, color: true } },
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(pagination?.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
    }),
    prisma.transaction.count({ where }),
  ])

  const hasMore = transactions.length > limit
  const page = hasMore ? transactions.slice(0, limit) : transactions

  return {
    transactions: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    total,
  }
}

export type UpdateTransactionInput = {
  scope: WorkspaceScope
  transactionId: string
  categoryId?: string | null
  entityId?: string
  notes?: string | null
  excludeFromReports?: boolean
  isTransfer?: boolean
  /** The answer to "apply this to future transactions from this merchant?" */
  applyToFuture?: boolean
  /** Also rewrite matching history, not just future transactions. */
  applyToPast?: boolean
  context?: RequestContext
}

export async function updateTransaction(input: UpdateTransactionInput) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: input.transactionId, workspaceId: input.scope.workspaceId },
  })
  if (!transaction) throw new Error('Transaction not found')

  // Moving a transaction to another entity must move its ledger too, or the
  // personal and business books stop agreeing with the entity that owns it.
  let ledger = transaction.ledger
  if (input.entityId && input.entityId !== transaction.entityId) {
    const entity = await prisma.entity.findFirst({
      where: { id: input.entityId, workspaceId: input.scope.workspaceId },
      select: { ledger: true },
    })
    if (!entity) throw new Error('Entity not found')
    ledger = entity.ledger
  }

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.entityId ? { entityId: input.entityId, ledger } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.excludeFromReports !== undefined
        ? { excludeFromReports: input.excludeFromReports }
        : {}),
      ...(input.isTransfer !== undefined ? { isTransfer: input.isTransfer } : {}),
    },
  })

  let ruleId: string | null = null
  let backfilled = 0

  if (input.applyToFuture) {
    const pattern = (transaction.merchantName ?? transaction.rawName).trim()

    if (pattern.length >= 3) {
      const rule = await createRule({
        scope: input.scope,
        matchType: 'MERCHANT_CONTAINS',
        pattern,
        categoryId: input.categoryId ?? null,
        entityId: input.entityId ?? null,
        // Priority 50 puts user-created rules ahead of anything seeded at the
        // default of 100.
        priority: 50,
        ...(input.context ? { context: input.context } : {}),
      })
      ruleId = rule.id

      if (input.applyToPast) {
        backfilled = await backfillRule({
          scope: input.scope,
          ruleId: rule.id,
          ...(input.context ? { context: input.context } : {}),
        })
      }
    }
  }

  await recordAuditSafe({
    action: AUDIT_ACTIONS.transactionUpdated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'transaction',
    resourceId: transaction.id,
    metadata: {
      fields: Object.keys(input).filter((key) => !['scope', 'context', 'transactionId'].includes(key)),
      ruleCreated: ruleId,
      backfilled,
    },
    ...(input.context ? { context: input.context } : {}),
  })

  return { transaction: updated, ruleId, backfilled }
}

export async function listCategories(scope: WorkspaceScope) {
  return prisma.category.findMany({
    where: { workspaceId: scope.workspaceId },
    include: { parent: { select: { name: true } } },
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
  })
}
