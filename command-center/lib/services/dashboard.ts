import 'server-only'
import { subMonths, startOfMonth, differenceInCalendarMonths } from 'date-fns'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import { ledgerFilter, type DashboardFilters } from '@/lib/validation/filters'
import type { FlowTransaction } from '@/lib/finance/cash-flow'
import type { PositionAccount } from '@/lib/finance/net-worth'
import type { DebtAccount } from '@/lib/finance/debt'
import type { BillOccurrenceInput } from '@/lib/finance/bills'
import type { DateRange } from '@/lib/finance/periods'

/**
 * The read layer for dashboards.
 *
 * Pages fetch a `FinancialContext` once and hand it to the pure functions in
 * lib/finance. That keeps the number of database round-trips per page fixed
 * regardless of how many tiles the page renders, and it means every figure on a
 * page is computed from the same snapshot rather than from several queries taken
 * at slightly different moments.
 */

export type FinancialContext = {
  accounts: AccountRow[]
  transactions: FlowTransaction[]
  /** Wider window than the selected period, for trend comparisons. */
  trendTransactions: FlowTransaction[]
  occurrences: BillOccurrenceInput[]
  entities: EntityRow[]
  recurringSeries: RecurringRow[]
  filters: DashboardFilters
  now: Date
}

export type RecurringRow = {
  id: string
  merchantName: string
  averageAmount: string
  lastAmount: string
  cadence: import('@prisma/client').Cadence
  status: import('@prisma/client').SeriesStatus
  confidence: number
  nextExpectedAt: Date | null
  ledger: 'PERSONAL' | 'BUSINESS'
  entityId: string
  categoryName: string | null
  accountName: string | null
}

export type AccountRow = PositionAccount &
  DebtAccount & {
    name: string
    officialName: string | null
    subtype: string | null
    classification: string
    institutionName: string
    entityName: string
    entityColor: string
    isManual: boolean
    isDisconnected: boolean
    lastSyncedAt: Date | null
    lastStatementAt: Date | null
    availableBalance: string | null
  }

export type EntityRow = {
  id: string
  name: string
  ledger: 'PERSONAL' | 'BUSINESS'
  kind: string
  color: string
  minCashReserve: string | null
}

export async function loadFinancialContext(
  scope: WorkspaceScope,
  filters: DashboardFilters,
  now: Date = new Date(),
): Promise<FinancialContext> {
  const ledger = ledgerFilter(filters.ledger)

  // Trends need twelve months regardless of the selected period, and the
  // selected period may itself reach further back, so take whichever is wider.
  const trendStart = startOfMonth(subMonths(now, 12))
  const transactionStart = filters.range.start < trendStart ? filters.range.start : trendStart

  const [accountRows, transactionRows, occurrenceRows, entityRows, recurringRows] = await Promise.all([
    prisma.account.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(ledger ? { ledger } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
      },
      include: { entity: { select: { name: true, color: true } } },
      orderBy: [{ sortOrder: 'asc' }, { institutionName: 'asc' }, { name: 'asc' }],
    }),

    prisma.transaction.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(ledger ? { ledger } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        postedAt: { gte: transactionStart, lte: filters.range.end > now ? filters.range.end : now },
      },
      include: {
        category: { select: { id: true, name: true, group: true } },
        account: { select: { type: true } },
      },
      orderBy: { postedAt: 'desc' },
    }),

    prisma.billOccurrence.findMany({
      where: {
        bill: {
          workspaceId: scope.workspaceId,
          ...(ledger ? { ledger } : {}),
          ...(filters.entityId ? { entityId: filters.entityId } : {}),
          status: 'ACTIVE',
        },
        dueAt: { gte: subMonths(now, 2), lte: subMonths(now, -3) },
      },
      include: {
        bill: {
          include: {
            entity: { select: { id: true, name: true, ledger: true } },
            category: { select: { name: true } },
            fundingAccount: { select: { name: true, mask: true } },
          },
        },
      },
      orderBy: { dueAt: 'asc' },
    }),

    prisma.entity.findMany({
      where: { workspaceId: scope.workspaceId, archivedAt: null },
      orderBy: [{ ledger: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
    }),

    prisma.recurringSeries.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        status: { not: 'IGNORED' },
      },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
        entity: { select: { ledger: true } },
      },
      orderBy: [{ status: 'asc' }, { confidence: 'desc' }],
    }),
  ])

  const accounts: AccountRow[] = accountRows.map((account) => ({
    id: account.id,
    name: account.name,
    officialName: account.officialName,
    institutionName: account.institutionName,
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    classification: account.classification,
    ledger: account.ledger,
    entityId: account.entityId,
    entityName: account.entity.name,
    entityColor: account.entity.color,
    currentBalance: account.currentBalance,
    availableBalance: account.availableBalance ? account.availableBalance.toFixed(2) : null,
    creditLimit: account.creditLimit,
    apr: account.apr ? account.apr.toNumber() : null,
    minimumPayment: account.minimumPayment,
    nextPaymentDueAt: account.nextPaymentDueAt,
    lastStatementBalance: account.lastStatementBalance,
    lastStatementAt: account.lastStatementAt,
    includeInNetWorth: account.includeInNetWorth,
    isClosed: account.isClosed,
    isManual: account.isManual,
    isDisconnected: account.isDisconnected,
    lastSyncedAt: account.lastSyncedAt,
  }))

  const trendTransactions: FlowTransaction[] = transactionRows.map((transaction) => ({
    id: transaction.id,
    postedAt: transaction.postedAt,
    amount: transaction.amount,
    ledger: transaction.ledger,
    entityId: transaction.entityId,
    accountId: transaction.accountId,
    accountType: transaction.account.type,
    categoryId: transaction.categoryId,
    categoryName: transaction.category?.name ?? null,
    categoryGroup: transaction.category?.group ?? null,
    merchantName: transaction.merchantName,
    isTransfer: transaction.isTransfer,
    isRecurring: transaction.isRecurring,
    excludeFromReports: transaction.excludeFromReports,
    pending: transaction.pending,
  }))

  const occurrences: BillOccurrenceInput[] = occurrenceRows.map((occurrence) => ({
    id: occurrence.id,
    billId: occurrence.billId,
    billName: occurrence.bill.name,
    payeeName: occurrence.bill.payeeName,
    dueAt: occurrence.dueAt,
    amountDue: occurrence.amountDue,
    status: occurrence.status,
    autopay: occurrence.bill.autopay,
    ledger: occurrence.bill.ledger,
    entityId: occurrence.bill.entityId,
    entityName: occurrence.bill.entity.name,
    categoryName: occurrence.bill.category?.name ?? null,
    fundingAccountName: occurrence.bill.fundingAccount?.name ?? null,
    fundingAccountMask: occurrence.bill.fundingAccount?.mask ?? null,
    paidAt: occurrence.paidAt,
    paidAmount: occurrence.paidAmount,
  }))

  return {
    accounts,
    transactions: trendTransactions.filter(
      (t) => t.postedAt >= filters.range.start && t.postedAt <= filters.range.end,
    ),
    trendTransactions,
    occurrences,
    recurringSeries: recurringRows
      .filter((series) => !ledger || series.entity.ledger === ledger)
      .map((series) => ({
        id: series.id,
        merchantName: series.merchantName,
        averageAmount: series.averageAmount.toFixed(2),
        lastAmount: series.lastAmount.toFixed(2),
        cadence: series.cadence,
        status: series.status,
        confidence: series.confidence,
        nextExpectedAt: series.nextExpectedAt,
        ledger: series.entity.ledger,
        entityId: series.entityId,
        categoryName: series.category?.name ?? null,
        accountName: series.account?.name ?? null,
      })),
    entities: entityRows.map((entity) => ({
      id: entity.id,
      name: entity.name,
      ledger: entity.ledger,
      kind: entity.kind,
      color: entity.color,
      minCashReserve: entity.minCashReserve ? entity.minCashReserve.toFixed(2) : null,
    })),
    filters,
    now,
  }
}

/** Number of whole months a range spans, floored at one. */
export function monthsInRange(range: DateRange): number {
  return Math.max(1, differenceInCalendarMonths(range.end, range.start) + 1)
}

/** Net-worth trend from daily balance snapshots. */
export async function loadNetWorthTrend(
  scope: WorkspaceScope,
  months: number,
  ledger?: 'PERSONAL' | 'BUSINESS',
): Promise<{ date: string; assets: number; liabilities: number; netWorth: number }[]> {
  const since = startOfMonth(subMonths(new Date(), months))

  const snapshots = await prisma.accountBalanceSnapshot.findMany({
    where: {
      asOf: { gte: since },
      account: {
        workspaceId: scope.workspaceId,
        includeInNetWorth: true,
        isClosed: false,
        ...(ledger ? { ledger } : {}),
      },
    },
    select: {
      asOf: true,
      current: true,
      account: { select: { type: true } },
    },
    orderBy: { asOf: 'asc' },
  })

  const LIABILITY_TYPES = new Set([
    'CREDIT_CARD',
    'LINE_OF_CREDIT',
    'AUTO_LOAN',
    'MORTGAGE',
    'STUDENT_LOAN',
    'PERSONAL_LOAN',
    'BUSINESS_LOAN',
    'OTHER_LIABILITY',
  ])

  const byDate = new Map<string, { assets: number; liabilities: number }>()

  for (const snapshot of snapshots) {
    const key = snapshot.asOf.toISOString().slice(0, 10)
    const bucket = byDate.get(key) ?? { assets: 0, liabilities: 0 }
    const value = snapshot.current.toNumber()

    if (LIABILITY_TYPES.has(snapshot.account.type)) bucket.liabilities += Math.abs(value)
    else bucket.assets += value

    byDate.set(key, bucket)
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => ({
      date,
      assets: Number(totals.assets.toFixed(2)),
      liabilities: Number(totals.liabilities.toFixed(2)),
      netWorth: Number((totals.assets - totals.liabilities).toFixed(2)),
    }))
}
