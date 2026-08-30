import 'server-only'
import { subDays } from 'date-fns'
import type { SeriesStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { DETECTION, detectRecurringSeries, type RecurrenceCandidate } from '@/lib/finance/recurrence'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'

/**
 * Persistence for detected recurring series.
 *
 * Detection is a pure function in lib/finance/recurrence. This module feeds it
 * transactions, stores what it found, and — importantly — preserves the user's
 * decisions. A series the user marked IGNORED stays ignored on the next sync;
 * detection never resurrects it.
 */

export async function refreshRecurringSeries(workspaceId: string): Promise<number> {
  const since = subDays(new Date(), DETECTION.lookbackDays)

  const transactions = await prisma.transaction.findMany({
    where: { workspaceId, postedAt: { gte: since }, pending: false },
    select: {
      id: true,
      postedAt: true,
      amount: true,
      merchantName: true,
      rawName: true,
      accountId: true,
      entityId: true,
      categoryId: true,
      isTransfer: true,
    },
  })

  const candidates: RecurrenceCandidate[] = transactions.map((transaction) => ({
    id: transaction.id,
    postedAt: transaction.postedAt,
    amount: transaction.amount,
    merchantName: transaction.merchantName,
    rawName: transaction.rawName,
    accountId: transaction.accountId,
    entityId: transaction.entityId,
    categoryId: transaction.categoryId,
    isTransfer: transaction.isTransfer,
  }))

  const detected = detectRecurringSeries(candidates, new Date())
  const detectedKeys = new Set(detected.map((series) => `${series.normalizedKey}::${series.accountId}`))
  let stored = 0

  for (const series of detected) {
    const existing = await prisma.recurringSeries.findUnique({
      where: {
        workspaceId_normalizedKey_accountId: {
          workspaceId,
          normalizedKey: series.normalizedKey,
          accountId: series.accountId,
        },
      },
      select: { id: true, status: true },
    })

    // A user's Add/Ignore decision survives re-detection.
    const status: SeriesStatus = existing?.status ?? 'DETECTED'

    const record = await prisma.recurringSeries.upsert({
      where: {
        workspaceId_normalizedKey_accountId: {
          workspaceId,
          normalizedKey: series.normalizedKey,
          accountId: series.accountId,
        },
      },
      update: {
        merchantName: series.merchantName,
        cadence: series.cadence,
        averageAmount: series.averageAmount.toFixed(2),
        lastAmount: series.lastAmount.toFixed(2),
        minAmount: series.minAmount.toFixed(2),
        maxAmount: series.maxAmount.toFixed(2),
        lastOccurredAt: series.lastOccurredAt,
        nextExpectedAt: series.nextExpectedAt,
        dayOfMonth: series.dayOfMonth,
        occurrenceCount: series.occurrenceCount,
        confidence: series.confidence,
        isIncome: series.isIncome,
        status,
      },
      create: {
        workspaceId,
        entityId: series.entityId,
        accountId: series.accountId,
        categoryId: series.categoryId,
        merchantName: series.merchantName,
        normalizedKey: series.normalizedKey,
        cadence: series.cadence,
        averageAmount: series.averageAmount.toFixed(2),
        lastAmount: series.lastAmount.toFixed(2),
        minAmount: series.minAmount.toFixed(2),
        maxAmount: series.maxAmount.toFixed(2),
        lastOccurredAt: series.lastOccurredAt,
        nextExpectedAt: series.nextExpectedAt,
        dayOfMonth: series.dayOfMonth,
        occurrenceCount: series.occurrenceCount,
        confidence: series.confidence,
        isIncome: series.isIncome,
      },
    })

    await prisma.transaction.updateMany({
      where: { id: { in: series.transactionIds } },
      data: { isRecurring: true, recurringSeriesId: record.id },
    })

    stored += 1
  }

  // Retract proposals the detector no longer stands behind.
  //
  // The common case is a series that only looked recurring until the other side
  // of an internal transfer arrived: syncing the checking account sees a monthly
  // "American Express Payment", and syncing the card later reveals it as a
  // transfer, which detection then skips. Without this, the stale proposal would
  // sit on the Recurring page forever.
  //
  // Only DETECTED rows are removed — a CONFIRMED series is the user's decision,
  // and an IGNORED one has to persist or it would be re-proposed next sync.
  const stale = await prisma.recurringSeries.findMany({
    where: { workspaceId, status: 'DETECTED', bills: { none: {} } },
    select: { id: true, normalizedKey: true, accountId: true },
  })

  const staleIds = stale
    .filter((series) => !detectedKeys.has(`${series.normalizedKey}::${series.accountId}`))
    .map((series) => series.id)

  if (staleIds.length > 0) {
    await prisma.transaction.updateMany({
      where: { recurringSeriesId: { in: staleIds } },
      data: { isRecurring: false, recurringSeriesId: null },
    })
    await prisma.recurringSeries.deleteMany({ where: { id: { in: staleIds } } })
  }

  return stored
}

export async function listRecurring(
  scope: WorkspaceScope,
  filter?: { status?: SeriesStatus; includeIncome?: boolean },
) {
  return prisma.recurringSeries.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.includeIncome ? {} : { isIncome: false }),
    },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, mask: true, institutionName: true } },
      entity: { select: { id: true, name: true, ledger: true } },
      _count: { select: { bills: true } },
    },
    orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
  })
}

/** The Add / Ignore / Edit actions on a detection proposal. */
export async function updateSeries(input: {
  scope: WorkspaceScope
  seriesId: string
  status?: SeriesStatus
  categoryId?: string | null
  averageAmount?: string
  cadence?: Parameters<typeof prisma.recurringSeries.update>[0]['data']['cadence']
  context?: RequestContext
}) {
  const series = await prisma.recurringSeries.findFirst({
    where: { id: input.seriesId, workspaceId: input.scope.workspaceId },
  })
  if (!series) throw new Error('Recurring series not found')

  const updated = await prisma.recurringSeries.update({
    where: { id: series.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.averageAmount ? { averageAmount: input.averageAmount } : {}),
      ...(input.cadence ? { cadence: input.cadence } : {}),
    },
  })

  if (input.status) {
    await recordAuditSafe({
      action:
        input.status === 'CONFIRMED' ? AUDIT_ACTIONS.recurringConfirmed : AUDIT_ACTIONS.recurringIgnored,
      workspaceId: input.scope.workspaceId,
      userId: input.scope.userId,
      resourceType: 'recurring_series',
      resourceId: series.id,
      metadata: { merchant: series.merchantName, status: input.status },
      ...(input.context ? { context: input.context } : {}),
    })
  }

  return updated
}
