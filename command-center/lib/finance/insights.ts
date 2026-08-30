import { differenceInCalendarDays, format } from 'date-fns'
import type { InsightKind, InsightSeverity, Ledger } from '@prisma/client'
import { formatMoney, formatPercent, money, percentChange, type Money, type MoneyInput } from './money'
import { CARD_THRESHOLDS, type CardDetail, type DebtSummary } from './debt'
import type { BillOccurrenceInput } from './bills'
import type { EntityPerformance } from './pnl'
import type { CategoryTotal } from './cash-flow'
import { CADENCE_LABELS } from './recurrence'
import type { Cadence } from '@prisma/client'

/**
 * The insights engine.
 *
 * Deterministic rules over figures that were already computed elsewhere — this
 * module does no aggregation of its own, it only decides what is worth saying.
 *
 * Two constraints, both from the brief:
 *   - Plain language. "Your Chase card is at 82% utilization", not "utilization
 *     ratio exceeds recommended threshold".
 *   - No regulated financial advice. Every string here states an observation or
 *     an arithmetic result. None of them tells the user what to do about it.
 */

export type GeneratedInsight = {
  kind: InsightKind
  severity: InsightSeverity
  title: string
  body: string
  ledger: Ledger | null
  entityId: string | null
  accountId: string | null
  metricValue: Money | null
  comparisonValue: Money | null
  periodStart: Date | null
  periodEnd: Date | null
  dedupeKey: string
}

export type InsightInput = {
  now: Date
  periodKey: string
  periodStart: Date
  periodEnd: Date

  personalExpenses: Money
  personalExpensesPrevious: Money
  businessExpenses: Money
  businessExpensesPrevious: Money

  personalAvailableCash: Money
  businessAvailableCash: Money
  monthlyExpenseRunRate: Money

  cards: CardDetail[]
  debt: DebtSummary

  upcomingBills: BillOccurrenceInput[]
  recurringMonthlyNow: Money
  recurringMonthlyThreeMonthsAgo: Money
  recurringSeries: {
    id: string
    merchantName: string
    averageAmount: MoneyInput
    lastAmount: MoneyInput
    cadence: Cadence
  }[]

  entityPerformance: EntityPerformance[]
  topCategories: CategoryTotal[]
  largeTransactions: {
    id: string
    merchantName: string
    amount: MoneyInput
    postedAt: Date
    categoryName: string | null
    accountId: string
    ledger: Ledger
    /** Median absolute amount for this category, for comparison. */
    categoryMedian: MoneyInput
  }[]
}

/** Thresholds live here so the UI can explain why something was surfaced. */
export const INSIGHT_THRESHOLDS = {
  spendingIncreasePercent: 0.15,
  spendingIncreaseMinimum: 200,
  recurringIncreaseMinimum: 50,
  subscriptionIncreasePercent: 0.15,
  subscriptionIncreaseMinimum: 5,
  unusualMultiple: 3,
  unusualMinimum: 250,
  maxUnusualTransactions: 3,
  largePaymentDays: 14,
  largePaymentCashShare: 0.25,
  excessCashMonths: 6,
  highInterestApr: 0.2,
  entityChangePercent: 0.15,
} as const

export function generateInsights(input: InsightInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const period = input.periodKey
  const base = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  }

  // --- Spending increases, per ledger -------------------------------------
  for (const [ledger, current, previous] of [
    ['PERSONAL', input.personalExpenses, input.personalExpensesPrevious],
    ['BUSINESS', input.businessExpenses, input.businessExpensesPrevious],
  ] as const) {
    const change = percentChange(current, previous)
    const delta = current.minus(previous)

    if (
      change !== null &&
      change >= INSIGHT_THRESHOLDS.spendingIncreasePercent &&
      delta.greaterThanOrEqualTo(INSIGHT_THRESHOLDS.spendingIncreaseMinimum)
    ) {
      const isBusiness = ledger === 'BUSINESS'
      insights.push({
        kind: isBusiness ? 'BUSINESS_EXPENSE_INCREASE' : 'SPENDING_INCREASE',
        severity: change >= 0.3 ? 'WARNING' : 'INFO',
        title: isBusiness
          ? `Business expenses are up ${formatPercent(change, 0)} this period`
          : `Personal spending is up ${formatPercent(change, 0)} this period`,
        body: `You spent ${formatMoney(current)} compared with ${formatMoney(
          previous,
        )} in the previous period — an increase of ${formatMoney(delta)}.`,
        ledger,
        entityId: null,
        accountId: null,
        metricValue: current,
        comparisonValue: previous,
        ...base,
        dedupeKey: `${isBusiness ? 'BUSINESS_EXPENSE_INCREASE' : 'SPENDING_INCREASE'}:${ledger}:${period}`,
      })
    }
  }

  // --- Recurring expense drift --------------------------------------------
  const recurringDelta = input.recurringMonthlyNow.minus(input.recurringMonthlyThreeMonthsAgo)
  if (recurringDelta.greaterThanOrEqualTo(INSIGHT_THRESHOLDS.recurringIncreaseMinimum)) {
    insights.push({
      kind: 'RECURRING_EXPENSE_INCREASE',
      severity: 'INFO',
      title: `Your recurring expenses increased ${formatMoney(recurringDelta)}/month`,
      // Says which window this measures, because the Recurring Expenses card
      // reports committed cost from confirmed series — a related but different
      // figure, and two unlabelled "recurring expenses" numbers that disagree
      // would just look like a bug.
      body: `Charges on recurring series totalled ${formatMoney(
        input.recurringMonthlyNow,
      )} over the last 30 days, against ${formatMoney(
        input.recurringMonthlyThreeMonthsAgo,
      )} in the same window three months ago.`,
      ledger: null,
      entityId: null,
      accountId: null,
      metricValue: input.recurringMonthlyNow,
      comparisonValue: input.recurringMonthlyThreeMonthsAgo,
      ...base,
      dedupeKey: `RECURRING_EXPENSE_INCREASE:all:${period}`,
    })
  }

  // --- Subscription price rises -------------------------------------------
  for (const series of input.recurringSeries) {
    const average = money(series.averageAmount)
    const last = money(series.lastAmount)
    const change = percentChange(last, average)
    const delta = last.minus(average)

    if (
      change !== null &&
      change >= INSIGHT_THRESHOLDS.subscriptionIncreasePercent &&
      delta.greaterThanOrEqualTo(INSIGHT_THRESHOLDS.subscriptionIncreaseMinimum)
    ) {
      insights.push({
        kind: 'SUBSCRIPTION_INCREASE',
        severity: 'INFO',
        title: `${series.merchantName} charged ${formatMoney(delta)} more than usual`,
        body: `The latest ${CADENCE_LABELS[
          series.cadence
        ].toLowerCase()} charge from ${series.merchantName} was ${formatMoney(
          last,
        )}, against an average of ${formatMoney(average)}.`,
        ledger: null,
        entityId: null,
        accountId: null,
        metricValue: last,
        comparisonValue: average,
        ...base,
        dedupeKey: `SUBSCRIPTION_INCREASE:${series.id}:${period}`,
      })
    }
  }

  // --- Credit utilization --------------------------------------------------
  for (const card of input.cards) {
    if (card.utilization === null) continue
    if (card.utilization < CARD_THRESHOLDS.highUtilization) continue

    insights.push({
      kind: 'HIGH_CREDIT_UTILIZATION',
      severity: card.utilization >= CARD_THRESHOLDS.criticalUtilization ? 'CRITICAL' : 'WARNING',
      title: `Your ${card.account.name} is at ${formatPercent(card.utilization, 0)} utilization`,
      body: `The balance is ${formatMoney(card.balance)} against a ${formatMoney(
        card.creditLimit ?? 0,
      )} limit, leaving ${formatMoney(card.availableCredit ?? 0)} available.`,
      ledger: card.account.ledger,
      entityId: card.account.entityId,
      accountId: card.account.id,
      metricValue: card.balance,
      comparisonValue: card.creditLimit,
      ...base,
      dedupeKey: `HIGH_CREDIT_UTILIZATION:${card.account.id}:${period}`,
    })
  }

  // --- High-interest debt --------------------------------------------------
  const highInterest = input.debt.accounts.filter(
    (a) => typeof a.apr === 'number' && a.apr >= INSIGHT_THRESHOLDS.highInterestApr && money(a.currentBalance).abs().greaterThan(0),
  )
  for (const account of highInterest) {
    const balance = money(account.currentBalance).abs()
    const monthlyInterest = balance.times((account.apr ?? 0) / 12)

    insights.push({
      kind: 'HIGH_INTEREST_DEBT',
      severity: 'WARNING',
      title: `${account.name} carries a ${formatPercent(account.apr, 2)} APR`,
      body: `At the current balance of ${formatMoney(
        balance,
      )}, that APR accrues about ${formatMoney(monthlyInterest)} in interest a month.`,
      ledger: account.ledger,
      entityId: account.entityId,
      accountId: account.id,
      metricValue: balance,
      comparisonValue: monthlyInterest,
      ...base,
      dedupeKey: `HIGH_INTEREST_DEBT:${account.id}:${period}`,
    })
  }

  // --- Upcoming large payments --------------------------------------------
  const totalCash = input.personalAvailableCash.plus(input.businessAvailableCash)
  for (const bill of input.upcomingBills) {
    const daysAway = differenceInCalendarDays(bill.dueAt, input.now)
    if (daysAway < 0 || daysAway > INSIGHT_THRESHOLDS.largePaymentDays) continue

    const amount = money(bill.amountDue)
    const share = totalCash.greaterThan(0) ? amount.dividedBy(totalCash).toNumber() : 1

    if (share >= INSIGHT_THRESHOLDS.largePaymentCashShare) {
      insights.push({
        kind: 'UPCOMING_LARGE_PAYMENT',
        severity: 'WARNING',
        title: `${bill.billName} of ${formatMoney(amount)} is due ${
          daysAway === 0 ? 'today' : `in ${daysAway} day${daysAway === 1 ? '' : 's'}`
        }`,
        body: `That is ${formatPercent(share, 0)} of your ${formatMoney(
          totalCash,
        )} available cash, due ${format(bill.dueAt, 'MMMM d')}.`,
        ledger: bill.ledger,
        entityId: bill.entityId,
        accountId: null,
        metricValue: amount,
        comparisonValue: totalCash,
        ...base,
        dedupeKey: `UPCOMING_LARGE_PAYMENT:${bill.id}:${period}`,
      })
    }
  }

  // --- Overdue bills -------------------------------------------------------
  const overdue = input.upcomingBills.filter(
    (b) => b.status !== 'PAID' && b.status !== 'SKIPPED' && differenceInCalendarDays(b.dueAt, input.now) < 0,
  )
  if (overdue.length > 0) {
    const total = overdue.reduce<Money>((sum, b) => sum.plus(money(b.amountDue)), money(0))
    insights.push({
      kind: 'OVERDUE_BILL',
      severity: 'CRITICAL',
      title: `${overdue.length} bill${overdue.length === 1 ? ' is' : 's are'} past due`,
      body: `${overdue
        .slice(0, 3)
        .map((b) => `${b.billName} (${formatMoney(b.amountDue)}, due ${format(b.dueAt, 'MMM d')})`)
        .join('; ')}${overdue.length > 3 ? `, and ${overdue.length - 3} more` : ''}. Total ${formatMoney(total)}.`,
      ledger: null,
      entityId: null,
      accountId: null,
      metricValue: total,
      comparisonValue: null,
      ...base,
      dedupeKey: `OVERDUE_BILL:all:${period}`,
    })
  }

  // --- Cash-flow strain ----------------------------------------------------
  const nextThirtyDays = input.upcomingBills.filter((b) => {
    const days = differenceInCalendarDays(b.dueAt, input.now)
    return b.status !== 'PAID' && b.status !== 'SKIPPED' && days >= 0 && days <= 30
  })
  const thirtyDayTotal = nextThirtyDays.reduce<Money>((sum, b) => sum.plus(money(b.amountDue)), money(0))

  if (thirtyDayTotal.greaterThan(totalCash) && thirtyDayTotal.greaterThan(0)) {
    insights.push({
      kind: 'CASH_FLOW_STRAIN',
      severity: 'CRITICAL',
      title: 'Bills due in the next 30 days exceed your available cash',
      body: `${formatMoney(thirtyDayTotal)} across ${
        nextThirtyDays.length
      } bills is due in the next 30 days, against ${formatMoney(totalCash)} in available cash.`,
      ledger: null,
      entityId: null,
      accountId: null,
      metricValue: thirtyDayTotal,
      comparisonValue: totalCash,
      ...base,
      dedupeKey: `CASH_FLOW_STRAIN:all:${period}`,
    })
  }

  // --- Excess cash ---------------------------------------------------------
  if (input.monthlyExpenseRunRate.greaterThan(0)) {
    const monthsOfCash = totalCash.dividedBy(input.monthlyExpenseRunRate).toNumber()
    if (monthsOfCash >= INSIGHT_THRESHOLDS.excessCashMonths) {
      insights.push({
        kind: 'EXCESS_CASH',
        severity: 'INFO',
        title: `You are holding ${monthsOfCash.toFixed(1)} months of expenses in cash`,
        body: `Available cash is ${formatMoney(
          totalCash,
        )} against an average monthly spend of ${formatMoney(input.monthlyExpenseRunRate)}.`,
        ledger: null,
        entityId: null,
        accountId: null,
        metricValue: totalCash,
        comparisonValue: input.monthlyExpenseRunRate,
        ...base,
        dedupeKey: `EXCESS_CASH:all:${period}`,
      })
    }
  }

  // --- Unusual transactions ------------------------------------------------
  // Capped: three examples make the point, fifteen bury every other insight.
  let unusualCount = 0
  for (const transaction of input.largeTransactions) {
    if (unusualCount >= INSIGHT_THRESHOLDS.maxUnusualTransactions) break
    const amount = money(transaction.amount).abs()
    const median = money(transaction.categoryMedian).abs()

    if (median.lessThanOrEqualTo(0)) continue
    if (amount.lessThan(INSIGHT_THRESHOLDS.unusualMinimum)) continue
    if (amount.lessThan(median.times(INSIGHT_THRESHOLDS.unusualMultiple))) continue

    unusualCount += 1
    insights.push({
      kind: 'UNUSUAL_TRANSACTION',
      severity: 'INFO',
      title: `${formatMoney(amount)} at ${transaction.merchantName} is unusually large`,
      body: `This charge on ${format(transaction.postedAt, 'MMM d')} is about ${amount
        .dividedBy(median)
        .toFixed(1)}× the typical ${transaction.categoryName ?? 'uncategorized'} transaction of ${formatMoney(
        median,
      )}.`,
      ledger: transaction.ledger,
      entityId: null,
      accountId: transaction.accountId,
      metricValue: amount,
      comparisonValue: median,
      ...base,
      dedupeKey: `UNUSUAL_TRANSACTION:${transaction.id}:${period}`,
    })
  }

  // --- Business profitability trend ---------------------------------------
  for (const performance of input.entityPerformance) {
    const { pnl, revenueChange } = performance

    if (revenueChange !== null && Math.abs(revenueChange) >= INSIGHT_THRESHOLDS.entityChangePercent) {
      insights.push({
        kind: 'BUSINESS_PROFITABILITY_TREND',
        severity: revenueChange < 0 ? 'WARNING' : 'INFO',
        title: `${pnl.entityName} revenue is ${revenueChange >= 0 ? 'up' : 'down'} ${formatPercent(
          Math.abs(revenueChange),
          0,
        )}`,
        body: `Revenue was ${formatMoney(pnl.revenue)} this period with ${formatMoney(
          pnl.operatingExpenses,
        )} in expenses, for net operating income of ${formatMoney(pnl.netOperatingIncome)}${
          pnl.profitMargin !== null ? ` and a ${formatPercent(pnl.profitMargin, 1)} margin` : ''
        }.`,
        ledger: 'BUSINESS',
        entityId: pnl.entityId,
        accountId: null,
        metricValue: pnl.revenue,
        comparisonValue: pnl.operatingExpenses,
        ...base,
        dedupeKey: `BUSINESS_PROFITABILITY_TREND:${pnl.entityId}:${period}`,
      })
    }
  }

  // --- Personal spending mix ----------------------------------------------
  const topCategory = input.topCategories[0]
  if (topCategory && topCategory.shareOfTotal >= 0.25) {
    insights.push({
      kind: 'PERSONAL_SPENDING_TREND',
      severity: 'INFO',
      title: `${topCategory.categoryName} was ${formatPercent(
        topCategory.shareOfTotal,
        0,
      )} of your spending`,
      body: `${formatMoney(topCategory.total)} across ${
        topCategory.transactionCount
      } transactions — the largest category this period.`,
      ledger: null,
      entityId: null,
      accountId: null,
      metricValue: topCategory.total,
      comparisonValue: null,
      ...base,
      dedupeKey: `PERSONAL_SPENDING_TREND:${topCategory.categoryId ?? 'uncategorized'}:${period}`,
    })
  }

  return sortBySeverity(insights)
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

export function sortBySeverity<T extends { severity: InsightSeverity }>(insights: T[]): T[] {
  return [...insights].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
