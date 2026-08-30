import 'server-only'
import { subDays, subMonths } from 'date-fns'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import { money, sumBy, ZERO, type Money } from '@/lib/finance/money'
import { computeCashByLedger } from '@/lib/finance/net-worth'
import { describeCard, summarizeDebt } from '@/lib/finance/debt'
import { isRevolving } from '@/lib/finance/account-kind'
import {
  computeIncomeExpense,
  spendingByCategory,
  withinRange,
  reportable,
  type FlowTransaction,
} from '@/lib/finance/cash-flow'
import { computeEntityPerformance } from '@/lib/finance/pnl'
import { generateInsights, sortBySeverity, type GeneratedInsight } from '@/lib/finance/insights'
import { loadFinancialContext, monthsInRange, type FinancialContext } from './dashboard'
import type { DashboardFilters } from '@/lib/validation/filters'

/**
 * Assembles the inputs for the insights rules engine and persists what it
 * produces.
 *
 * Regeneration is idempotent: each insight carries a dedupe key of
 * kind + scope + period, so running this after every sync refreshes the numbers
 * rather than accumulating duplicates. A dismissed insight stays dismissed.
 */

export async function regenerateInsights(
  scope: WorkspaceScope,
  filters: DashboardFilters,
  now: Date = new Date(),
): Promise<number> {
  const context = await loadFinancialContext(scope, filters, now)
  const generated = buildInsights(context)

  for (const insight of generated) {
    const existing = await prisma.insight.findUnique({
      where: { workspaceId_dedupeKey: { workspaceId: scope.workspaceId, dedupeKey: insight.dedupeKey } },
      select: { id: true, dismissedAt: true },
    })

    const data = {
      kind: insight.kind,
      severity: insight.severity,
      ledger: insight.ledger,
      entityId: insight.entityId,
      accountId: insight.accountId,
      title: insight.title,
      body: insight.body,
      metricValue: insight.metricValue ? insight.metricValue.toFixed(2) : null,
      comparisonValue: insight.comparisonValue ? insight.comparisonValue.toFixed(2) : null,
      periodStart: insight.periodStart,
      periodEnd: insight.periodEnd,
      generatedAt: now,
    }

    if (existing) {
      // Refresh the numbers but leave a dismissal in place.
      await prisma.insight.update({ where: { id: existing.id }, data })
    } else {
      await prisma.insight.create({
        data: { ...data, workspaceId: scope.workspaceId, dedupeKey: insight.dedupeKey },
      })
    }
  }

  // Anything the engine no longer produces has stopped being true.
  const currentKeys = generated.map((insight) => insight.dedupeKey)
  await prisma.insight.deleteMany({
    where: {
      workspaceId: scope.workspaceId,
      dismissedAt: null,
      ...(currentKeys.length > 0 ? { dedupeKey: { notIn: currentKeys } } : {}),
    },
  })

  return generated.length
}

/** Pure assembly: context in, insights out. Exported so it can be exercised directly. */
export function buildInsights(context: FinancialContext): GeneratedInsight[] {
  const { accounts, transactions, trendTransactions, occurrences, entities, recurringSeries, filters, now } =
    context

  const cashByLedger = computeCashByLedger(accounts)
  const debt = summarizeDebt(accounts)
  const cards = accounts.filter((account) => isRevolving(account.type) && !account.isClosed).map((account) => describeCard(account, now))

  const personal = transactions.filter((t) => t.ledger === 'PERSONAL')
  const business = transactions.filter((t) => t.ledger === 'BUSINESS')
  const personalPrevious = withinRange(
    trendTransactions.filter((t) => t.ledger === 'PERSONAL'),
    filters.previousRange,
  )
  const businessPrevious = withinRange(
    trendTransactions.filter((t) => t.ledger === 'BUSINESS'),
    filters.previousRange,
  )

  // Recurring drift is measured from the transactions themselves rather than
  // from the series definitions, so it reflects what was actually charged.
  const recurringMonthlyNow = recurringOutflowTotal(trendTransactions, subDays(now, 30), now)
  const recurringMonthlyThreeMonthsAgo = recurringOutflowTotal(
    trendTransactions,
    subDays(subMonths(now, 3), 30),
    subMonths(now, 3),
  )

  const monthlyExpenseRunRate = computeIncomeExpense(
    withinRange(trendTransactions, { start: subMonths(now, 3), end: now }),
  ).expenses.dividedBy(3)

  const entityPerformance = entities
    .filter((entity) => entity.ledger === 'BUSINESS')
    .map((entity) =>
      computeEntityPerformance({
        entityId: entity.id,
        entityName: entity.name,
        transactions: trendTransactions,
        range: filters.range,
        previousRange: filters.previousRange,
        cashBalance: sumBy(
          accounts.filter((a) => a.entityId === entity.id && !a.isClosed),
          (a) => (a.type === 'CHECKING' || a.type === 'SAVINGS' || a.type === 'MONEY_MARKET' ? a.currentBalance : 0),
        ),
        businessDebt: sumBy(
          accounts.filter((a) => a.entityId === entity.id && !a.isClosed),
          (a) => (isLiabilityType(a.type) ? money(a.currentBalance).abs() : 0),
        ),
        monthsInRange: monthsInRange(filters.range),
      }),
    )

  return generateInsights({
    now,
    periodKey: filters.period,
    periodStart: filters.range.start,
    periodEnd: filters.range.end,

    personalExpenses: computeIncomeExpense(personal).expenses,
    personalExpensesPrevious: computeIncomeExpense(personalPrevious).expenses,
    businessExpenses: computeIncomeExpense(business).expenses,
    businessExpensesPrevious: computeIncomeExpense(businessPrevious).expenses,

    personalAvailableCash: cashByLedger.personal.available,
    businessAvailableCash: cashByLedger.business.available,
    monthlyExpenseRunRate,

    cards,
    debt,

    upcomingBills: occurrences,
    recurringMonthlyNow,
    recurringMonthlyThreeMonthsAgo,
    recurringSeries: recurringSeries.filter((series) => series.status === 'CONFIRMED' || series.confidence >= 0.75),

    entityPerformance,
    // Personal only: the "largest category this period" insight is about
    // household spending, and a business payroll run would otherwise swamp it.
    topCategories: spendingByCategory(personal),
    largeTransactions: findUnusualTransactions(transactions, trendTransactions),
  })
}

function isLiabilityType(type: string): boolean {
  return [
    'CREDIT_CARD',
    'LINE_OF_CREDIT',
    'AUTO_LOAN',
    'MORTGAGE',
    'STUDENT_LOAN',
    'PERSONAL_LOAN',
    'BUSINESS_LOAN',
    'OTHER_LIABILITY',
  ].includes(type)
}

/** Only transactions the detector actually tied to a recurring series count. */
function recurringOutflowTotal(transactions: FlowTransaction[], start: Date, end: Date): Money {
  return reportable(withinRange(transactions, { start, end }))
    .filter((t) => t.isRecurring && money(t.amount).lessThan(0))
    .reduce<Money>((total, t) => total.plus(money(t.amount).abs()), ZERO)
}

/**
 * Flags transactions far above the typical size for their category. Medians come
 * from the wider trend window so a single unusual month does not become the
 * baseline it is measured against.
 */
function findUnusualTransactions(
  candidates: FlowTransaction[],
  history: FlowTransaction[],
): {
  id: string
  merchantName: string
  amount: string
  postedAt: Date
  categoryName: string | null
  accountId: string
  ledger: 'PERSONAL' | 'BUSINESS'
  categoryMedian: string
}[] {
  const byCategory = new Map<string, number[]>()

  for (const transaction of reportable(history)) {
    const amount = money(transaction.amount)
    if (amount.greaterThanOrEqualTo(0)) continue

    const key = transaction.categoryId ?? '__uncategorized__'
    const bucket = byCategory.get(key)
    if (bucket) bucket.push(amount.abs().toNumber())
    else byCategory.set(key, [amount.abs().toNumber()])
  }

  const medians = new Map<string, number>()
  for (const [key, amounts] of byCategory) {
    const sorted = amounts.sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    medians.set(
      key,
      sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? 0),
    )
  }

  return reportable(candidates)
    .filter((t) => money(t.amount).lessThan(0))
    .map((transaction) => ({
      id: transaction.id,
      merchantName: transaction.merchantName ?? 'Unknown merchant',
      amount: money(transaction.amount).toFixed(2),
      postedAt: transaction.postedAt,
      categoryName: transaction.categoryName,
      accountId: transaction.accountId,
      ledger: transaction.ledger,
      categoryMedian: String(medians.get(transaction.categoryId ?? '__uncategorized__') ?? 0),
    }))
    // A handful of the largest is enough; the engine still applies its own
    // multiple-of-median test.
    .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
    .slice(0, 25)
}

export async function listInsights(scope: WorkspaceScope, options?: { includeDismissed?: boolean }) {
  const insights = await prisma.insight.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(options?.includeDismissed ? {} : { dismissedAt: null }),
    },
    include: {
      entity: { select: { id: true, name: true, color: true } },
      account: { select: { id: true, name: true, mask: true } },
    },
    orderBy: { generatedAt: 'desc' },
  })

  return sortBySeverity(insights)
}

export async function dismissInsight(scope: WorkspaceScope, insightId: string): Promise<void> {
  await prisma.insight.updateMany({
    where: { id: insightId, workspaceId: scope.workspaceId },
    data: { dismissedAt: new Date() },
  })
}
