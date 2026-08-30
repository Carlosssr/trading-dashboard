import { money, percentChange, sumBy, ZERO, type Money } from './money'
import { reportable, withinRange, type FlowTransaction } from './cash-flow'
import type { DateRange } from './periods'

/**
 * Business P&L:
 *
 *   Revenue − Operating Expenses = Net Operating Income
 *
 * Computed per entity from that entity's own transactions only. Two entities are
 * never summed into one statement; the business dashboard shows a list of
 * statements, plus a total that adds the finished statements together.
 */

export type PnlLine = {
  categoryId: string | null
  categoryName: string
  total: Money
  transactionCount: number
  shareOfExpenses: number
}

export type ProfitAndLoss = {
  entityId: string
  entityName: string
  range: DateRange
  revenue: Money
  operatingExpenses: Money
  netOperatingIncome: Money
  /** Net operating income ÷ revenue. Null when there is no revenue to divide by. */
  profitMargin: number | null
  revenueLines: PnlLine[]
  expenseLines: PnlLine[]
  transactionCount: number
}

function toLines(transactions: FlowTransaction[], total: Money): PnlLine[] {
  const buckets = new Map<string, PnlLine>()

  for (const transaction of transactions) {
    const key = transaction.categoryId ?? '__uncategorized__'
    const amount = money(transaction.amount).abs()
    const existing = buckets.get(key)

    if (existing) {
      existing.total = existing.total.plus(amount)
      existing.transactionCount += 1
    } else {
      buckets.set(key, {
        categoryId: transaction.categoryId,
        categoryName: transaction.categoryName ?? 'Uncategorized',
        total: amount,
        transactionCount: 1,
        shareOfExpenses: 0,
      })
    }
  }

  const lines = [...buckets.values()]
  for (const line of lines) {
    line.shareOfExpenses = total.isZero() ? 0 : line.total.dividedBy(total).toNumber()
  }
  return lines.sort((a, b) => b.total.comparedTo(a.total))
}

export function computeProfitAndLoss(input: {
  entityId: string
  entityName: string
  transactions: FlowTransaction[]
  range: DateRange
}): ProfitAndLoss {
  const relevant = reportable(withinRange(input.transactions, input.range)).filter(
    (t) => t.entityId === input.entityId,
  )

  // Debt principal payments are balance-sheet movements, not operating expenses,
  // so they are excluded from both sides of the statement.
  const operating = relevant.filter((t) => t.categoryGroup !== 'DEBT_PAYMENT')

  const revenueTransactions = operating.filter((t) => money(t.amount).greaterThan(0))
  const expenseTransactions = operating.filter((t) => money(t.amount).lessThan(0))

  const revenue = sumBy(revenueTransactions, (t) => t.amount)
  const operatingExpenses = sumBy(expenseTransactions, (t) => money(t.amount).abs())
  const netOperatingIncome = revenue.minus(operatingExpenses)

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    range: input.range,
    revenue,
    operatingExpenses,
    netOperatingIncome,
    profitMargin: revenue.isZero() ? null : netOperatingIncome.dividedBy(revenue).toNumber(),
    revenueLines: toLines(revenueTransactions, revenue),
    expenseLines: toLines(expenseTransactions, operatingExpenses),
    transactionCount: operating.length,
  }
}

export type EntityPerformance = {
  pnl: ProfitAndLoss
  cashBalance: Money
  businessDebt: Money
  /** Average monthly operating expenses over the window. */
  monthlyBurn: Money
  /** Months of runway at current burn, null when burn is zero or income exceeds it. */
  runwayMonths: number | null
  revenueChange: number | null
  expenseChange: number | null
}

export function computeEntityPerformance(input: {
  entityId: string
  entityName: string
  transactions: FlowTransaction[]
  range: DateRange
  previousRange: DateRange
  cashBalance: Money
  businessDebt: Money
  monthsInRange: number
}): EntityPerformance {
  const pnl = computeProfitAndLoss({
    entityId: input.entityId,
    entityName: input.entityName,
    transactions: input.transactions,
    range: input.range,
  })

  const previous = computeProfitAndLoss({
    entityId: input.entityId,
    entityName: input.entityName,
    transactions: input.transactions,
    range: input.previousRange,
  })

  const months = Math.max(input.monthsInRange, 1)
  const monthlyBurn = pnl.operatingExpenses.dividedBy(months)
  const monthlyNet = pnl.netOperatingIncome.dividedBy(months)

  // Runway only means something when the entity is actually losing money.
  const runwayMonths =
    monthlyNet.greaterThanOrEqualTo(0) || monthlyNet.isZero()
      ? null
      : input.cashBalance.dividedBy(monthlyNet.abs()).toNumber()

  return {
    pnl,
    cashBalance: input.cashBalance,
    businessDebt: input.businessDebt,
    monthlyBurn,
    runwayMonths,
    revenueChange: percentChange(pnl.revenue, previous.revenue),
    expenseChange: percentChange(pnl.operatingExpenses, previous.operatingExpenses),
  }
}

export function totalAcrossEntities(performances: EntityPerformance[]): {
  revenue: Money
  expenses: Money
  netIncome: Money
  cash: Money
  debt: Money
} {
  return {
    revenue: performances.reduce<Money>((acc, p) => acc.plus(p.pnl.revenue), ZERO),
    expenses: performances.reduce<Money>((acc, p) => acc.plus(p.pnl.operatingExpenses), ZERO),
    netIncome: performances.reduce<Money>((acc, p) => acc.plus(p.pnl.netOperatingIncome), ZERO),
    cash: performances.reduce<Money>((acc, p) => acc.plus(p.cashBalance), ZERO),
    debt: performances.reduce<Money>((acc, p) => acc.plus(p.businessDebt), ZERO),
  }
}
