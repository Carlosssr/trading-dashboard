import type { AccountType, CategoryGroup, Ledger } from '@prisma/client'
import { isCash } from './account-kind'
import { money, percentChange, sumBy, ZERO, type Money, type MoneyInput } from './money'
import type { DateRange } from './periods'

/**
 * Two different questions that are easy to conflate:
 *
 *   Cash flow    — how much money moved through cash accounts. Credit card
 *                  spending is not cash flow until the card is paid.
 *   Income/expense — what was earned and spent by category, across every
 *                  account. A business lunch on a business card is an expense
 *                  the day it happens.
 *
 * Both exclude paired internal transfers, so paying a card off does not read as
 * $2,000 of spending plus $2,000 of income.
 */

export type FlowTransaction = {
  id: string
  postedAt: Date
  /** POSITIVE = money into the account. */
  amount: MoneyInput
  ledger: Ledger
  entityId: string
  accountId: string
  accountType: AccountType
  categoryId: string | null
  categoryName: string | null
  categoryGroup: CategoryGroup | null
  merchantName: string | null
  isTransfer: boolean
  excludeFromReports: boolean
  pending: boolean
}

export function reportable(transactions: FlowTransaction[]): FlowTransaction[] {
  return transactions.filter((t) => !t.excludeFromReports && !t.isTransfer && !t.pending)
}

export function withinRange(transactions: FlowTransaction[], range: DateRange): FlowTransaction[] {
  return transactions.filter((t) => t.postedAt >= range.start && t.postedAt <= range.end)
}

export type CashFlow = {
  inflow: Money
  outflow: Money
  net: Money
}

/** Movement through cash accounts only. */
export function computeCashFlow(transactions: FlowTransaction[]): CashFlow {
  const cashTransactions = reportable(transactions).filter((t) => isCash(t.accountType))

  const inflow = sumBy(
    cashTransactions.filter((t) => money(t.amount).greaterThan(0)),
    (t) => t.amount,
  )
  const outflow = sumBy(
    cashTransactions.filter((t) => money(t.amount).lessThan(0)),
    (t) => money(t.amount).abs(),
  )

  return { inflow, outflow, net: inflow.minus(outflow) }
}

export type IncomeExpense = {
  income: Money
  expenses: Money
  net: Money
}

/** Earned and spent by category, across every account. */
export function computeIncomeExpense(transactions: FlowTransaction[]): IncomeExpense {
  const relevant = reportable(transactions)

  // Sign is the source of truth, not the category group — an uncategorized
  // deposit still counts as income, and a refund posted to an expense category
  // correctly reduces expenses because it nets out within the same bucket.
  const income = sumBy(
    relevant.filter((t) => money(t.amount).greaterThan(0) && t.categoryGroup !== 'DEBT_PAYMENT'),
    (t) => t.amount,
  )
  const expenses = sumBy(
    relevant.filter((t) => money(t.amount).lessThan(0) && t.categoryGroup !== 'DEBT_PAYMENT'),
    (t) => money(t.amount).abs(),
  )

  return { income, expenses, net: income.minus(expenses) }
}

export type FlowComparison = {
  current: CashFlow
  previous: CashFlow
  netChange: number | null
  outflowChange: number | null
}

export function compareCashFlow(
  transactions: FlowTransaction[],
  current: DateRange,
  previous: DateRange,
): FlowComparison {
  const currentFlow = computeCashFlow(withinRange(transactions, current))
  const previousFlow = computeCashFlow(withinRange(transactions, previous))

  return {
    current: currentFlow,
    previous: previousFlow,
    netChange: percentChange(currentFlow.net, previousFlow.net),
    outflowChange: percentChange(currentFlow.outflow, previousFlow.outflow),
  }
}

export type CategoryTotal = {
  categoryId: string | null
  categoryName: string
  group: CategoryGroup | null
  total: Money
  transactionCount: number
  shareOfTotal: number
}

/** Spending by category, largest first. Used by the reports and insights pages. */
export function spendingByCategory(transactions: FlowTransaction[]): CategoryTotal[] {
  const spending = reportable(transactions).filter(
    (t) => money(t.amount).lessThan(0) && t.categoryGroup !== 'DEBT_PAYMENT',
  )

  const buckets = new Map<string, CategoryTotal>()
  for (const transaction of spending) {
    const key = transaction.categoryId ?? '__uncategorized__'
    const existing = buckets.get(key)
    const amount = money(transaction.amount).abs()

    if (existing) {
      existing.total = existing.total.plus(amount)
      existing.transactionCount += 1
    } else {
      buckets.set(key, {
        categoryId: transaction.categoryId,
        categoryName: transaction.categoryName ?? 'Uncategorized',
        group: transaction.categoryGroup,
        total: amount,
        transactionCount: 1,
        shareOfTotal: 0,
      })
    }
  }

  const totals = [...buckets.values()]
  const grandTotal = totals.reduce<Money>((acc, t) => acc.plus(t.total), ZERO)

  for (const bucket of totals) {
    bucket.shareOfTotal = grandTotal.isZero() ? 0 : bucket.total.dividedBy(grandTotal).toNumber()
  }

  return totals.sort((a, b) => b.total.comparedTo(a.total))
}

export type MonthlySeriesPoint = {
  key: string
  label: string
  income: number
  expenses: number
  net: number
}

/** Chart-ready series. Converts to `number` because Recharts cannot take Decimal. */
export function monthlySeries(
  transactions: FlowTransaction[],
  buckets: { start: Date; end: Date; label: string; key: string }[],
): MonthlySeriesPoint[] {
  return buckets.map((bucket) => {
    const slice = withinRange(transactions, { start: bucket.start, end: bucket.end })
    const { income, expenses, net } = computeIncomeExpense(slice)
    return {
      key: bucket.key,
      label: bucket.label,
      income: income.toNumber(),
      expenses: expenses.toNumber(),
      net: net.toNumber(),
    }
  })
}

/**
 * Estimated monthly gross income, used for debt-to-income. Averages positive
 * non-transfer cash inflows over the window rather than trusting a single month,
 * which would swing wildly for anyone with irregular income.
 */
export function estimateMonthlyIncome(transactions: FlowTransaction[], months: number): Money | null {
  if (months <= 0) return null
  const inflows = reportable(transactions).filter(
    (t) => isCash(t.accountType) && money(t.amount).greaterThan(0),
  )
  if (inflows.length === 0) return null
  return sumBy(inflows, (t) => t.amount).dividedBy(months)
}
