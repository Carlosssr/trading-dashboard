import type { AccountType, Ledger } from '@prisma/client'
import { isLiability, isRevolving } from './account-kind'
import { money, ratio, sumBy, ZERO, type Money, type MoneyInput } from './money'

/**
 * Debt dashboard arithmetic: totals, weighted average APR, credit utilization,
 * and debt-to-income.
 */

export type DebtAccount = {
  id: string
  name: string
  institutionName: string
  mask: string | null
  type: AccountType
  ledger: Ledger
  entityId: string
  currentBalance: MoneyInput
  creditLimit?: MoneyInput
  /** Decimal rate: 0.1899 means 18.99% APR. */
  apr?: number | null
  minimumPayment?: MoneyInput
  nextPaymentDueAt?: Date | null
  lastStatementBalance?: MoneyInput
  availableBalance?: MoneyInput
  isClosed: boolean
}

export type DebtSummary = {
  accounts: DebtAccount[]
  totalDebt: Money
  totalMinimumPayments: Money
  /** Balance-weighted, so a large mortgage at 3% is not averaged flat against a small card at 24%. */
  weightedAverageApr: number | null
  revolvingBalance: Money
  revolvingLimit: Money
  /** Aggregate revolving utilization, 0..1+. Null when no limits are known. */
  creditUtilization: number | null
  highestApr: DebtAccount | null
  largestBalance: DebtAccount | null
}

export function debtAccounts(accounts: DebtAccount[]): DebtAccount[] {
  return accounts.filter((a) => isLiability(a.type) && !a.isClosed)
}

export function summarizeDebt(allAccounts: DebtAccount[]): DebtSummary {
  const accounts = debtAccounts(allAccounts)
  const balanceOf = (a: DebtAccount) => money(a.currentBalance).abs()

  const totalDebt = sumBy(accounts, balanceOf)
  const totalMinimumPayments = sumBy(accounts, (a) => a.minimumPayment ?? 0)

  const revolving = accounts.filter((a) => isRevolving(a.type))
  const revolvingBalance = sumBy(revolving, balanceOf)
  const revolvingWithLimit = revolving.filter((a) => money(a.creditLimit).greaterThan(0))
  const revolvingLimit = sumBy(revolvingWithLimit, (a) => a.creditLimit)

  // Only cards with a known limit contribute to utilization; including a card
  // with an unknown limit would understate the ratio.
  const utilizationBalance = sumBy(revolvingWithLimit, balanceOf)

  const withApr = accounts.filter(
    (a) => typeof a.apr === 'number' && Number.isFinite(a.apr) && balanceOf(a).greaterThan(0),
  )
  const aprWeightBase = sumBy(withApr, balanceOf)
  const weightedAverageApr = aprWeightBase.isZero()
    ? null
    : withApr.reduce(
        (total, a) => total + (a.apr ?? 0) * balanceOf(a).dividedBy(aprWeightBase).toNumber(),
        0,
      )

  const highestApr =
    withApr.length === 0
      ? null
      : withApr.reduce((worst, a) => ((a.apr ?? 0) > (worst.apr ?? 0) ? a : worst))

  const largestBalance =
    accounts.length === 0
      ? null
      : accounts.reduce((biggest, a) => (balanceOf(a).greaterThan(balanceOf(biggest)) ? a : biggest))

  return {
    accounts,
    totalDebt,
    totalMinimumPayments,
    weightedAverageApr,
    revolvingBalance,
    revolvingLimit,
    creditUtilization: revolvingLimit.isZero() ? null : ratio(utilizationBalance, revolvingLimit),
    highestApr,
    largestBalance,
  }
}

export type CardDetail = {
  account: DebtAccount
  balance: Money
  creditLimit: Money | null
  availableCredit: Money | null
  utilization: number | null
  statementBalance: Money | null
  flags: CardFlag[]
}

export type CardFlag = 'high-utilization' | 'due-soon' | 'high-apr' | 'over-limit'

/** Thresholds are named rather than inlined so the UI legend can quote them. */
export const CARD_THRESHOLDS = {
  highUtilization: 0.3,
  criticalUtilization: 0.7,
  highApr: 0.2,
  dueSoonDays: 7,
} as const

export function describeCard(account: DebtAccount, now: Date): CardDetail {
  const balance = money(account.currentBalance).abs()
  const creditLimit = money(account.creditLimit).greaterThan(0) ? money(account.creditLimit) : null
  const availableCredit = creditLimit ? creditLimit.minus(balance) : null
  const utilization = creditLimit ? ratio(balance, creditLimit) : null

  const flags: CardFlag[] = []
  if (utilization !== null && utilization >= CARD_THRESHOLDS.highUtilization) {
    flags.push('high-utilization')
  }
  if (availableCredit && availableCredit.lessThan(0)) flags.push('over-limit')
  if (typeof account.apr === 'number' && account.apr >= CARD_THRESHOLDS.highApr) {
    flags.push('high-apr')
  }
  if (account.nextPaymentDueAt) {
    const daysAway = Math.ceil(
      (account.nextPaymentDueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    )
    if (daysAway >= 0 && daysAway <= CARD_THRESHOLDS.dueSoonDays) flags.push('due-soon')
  }

  return {
    account,
    balance,
    creditLimit,
    availableCredit,
    utilization,
    statementBalance: account.lastStatementBalance ? money(account.lastStatementBalance) : null,
    flags,
  }
}

/**
 * Debt-to-income against monthly gross income. Returns null rather than zero
 * when income is unknown, so the UI can say "needs income data" instead of
 * showing a confidently wrong 0%.
 */
export function debtToIncome(monthlyDebtPayments: MoneyInput, monthlyIncome: MoneyInput): number | null {
  const income = money(monthlyIncome)
  if (income.lessThanOrEqualTo(0)) return null
  return money(monthlyDebtPayments).dividedBy(income).toNumber()
}

/**
 * Months to payoff under a fixed payment, by simulation rather than the closed
 * form — it handles the "payment does not cover interest" case honestly instead
 * of returning a negative logarithm.
 */
export function monthsToPayoff(balance: MoneyInput, apr: number | null, monthlyPayment: MoneyInput): number | null {
  let remaining = money(balance).abs()
  const payment = money(monthlyPayment)
  if (remaining.isZero()) return 0
  if (payment.lessThanOrEqualTo(0)) return null

  const monthlyRate = (apr ?? 0) / 12
  for (let month = 1; month <= 600; month += 1) {
    const interest = remaining.times(monthlyRate)
    const principal = payment.minus(interest)
    if (principal.lessThanOrEqualTo(0)) return null // payment never catches interest
    remaining = remaining.minus(principal)
    if (remaining.lessThanOrEqualTo(0)) return month
  }
  return null
}

export function totalInterestThisMonth(accounts: DebtAccount[]): Money {
  return accounts.reduce((total, account) => {
    if (typeof account.apr !== 'number') return total
    return total.plus(money(account.currentBalance).abs().times(account.apr / 12))
  }, ZERO)
}
