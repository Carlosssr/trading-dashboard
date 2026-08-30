import 'server-only'
import { startOfDay, subDays, differenceInCalendarMonths, addMonths } from 'date-fns'
import { Decimal } from '@prisma/client/runtime/library'
import type { Account } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isLiability, isLoan } from '@/lib/finance/account-kind'

/**
 * Reconstructs daily balance history.
 *
 * Aggregation providers report a *current* balance and a transaction list; they
 * do not hand over what an account held on an arbitrary past date. Without
 * history the net-worth trend is a single point, so this walks backwards from
 * today's balance and undoes each transaction to recover the balance on each
 * prior day.
 *
 * Everything here is derived, never invented:
 *
 *   - Cash and card accounts are exact — value on day D is today's value minus
 *     every transaction posted after D.
 *   - Loans with a known rate and payment are amortized backwards, which is
 *     arithmetic, not a guess.
 *   - Investments and property are held flat, because we genuinely do not know
 *     what they were worth last March. A drifting line there would be fiction.
 */

/** Only run the expensive backfill for accounts that have no history yet. */
const MIN_EXISTING_SNAPSHOTS = 2

export async function backfillSnapshots(workspaceId: string, days = 365): Promise<number> {
  const accounts = await prisma.account.findMany({
    where: { workspaceId, isClosed: false },
    include: { _count: { select: { snapshots: true } } },
  })

  const today = startOfDay(new Date())
  const start = subDays(today, days)
  let written = 0

  for (const account of accounts) {
    if (account._count.snapshots >= MIN_EXISTING_SNAPSHOTS) continue

    const series = isLoan(account.type)
      ? amortizeBackwards(account, today, days)
      : await replayTransactions(account, today, start)

    if (series.length === 0) continue

    // createMany with skipDuplicates so today's snapshot, already written by the
    // sync, is left alone.
    const result = await prisma.accountBalanceSnapshot.createMany({
      data: series.map(({ asOf, value }) => ({
        accountId: account.id,
        asOf,
        current: value.toFixed(2),
      })),
      skipDuplicates: true,
    })
    written += result.count
  }

  return written
}

type SnapshotPoint = { asOf: Date; value: Decimal }

/**
 * Exact reconstruction for accounts whose movements are all transactions.
 *
 * Works in signed *account value* (liabilities negative) so one subtraction
 * handles both a checking account and a credit card, then converts back to the
 * positive-magnitude convention liabilities are stored in.
 */
async function replayTransactions(
  account: Account,
  today: Date,
  start: Date,
): Promise<SnapshotPoint[]> {
  const transactions = await prisma.transaction.findMany({
    where: { accountId: account.id, postedAt: { gte: start } },
    select: { postedAt: true, amount: true },
    orderBy: { postedAt: 'desc' },
  })

  const liability = isLiability(account.type)

  // No transactions means nothing is known to have moved — an investment
  // account, a property, an untouched savings account. Hold the current balance
  // flat rather than returning nothing: an account missing from the history
  // makes the whole net-worth line jump on the day it first appears.
  if (transactions.length === 0) {
    const flat: SnapshotPoint[] = []
    for (let cursor = today; cursor >= start; cursor = subDays(cursor, 1)) {
      flat.push({ asOf: cursor, value: account.currentBalance })
    }
    return flat
  }

  let value = liability ? account.currentBalance.abs().negated() : account.currentBalance

  const points: SnapshotPoint[] = []
  let index = 0
  let cursor = today

  while (cursor >= start) {
    points.push({ asOf: cursor, value: liability ? value.abs() : value })

    // Undo everything posted on this day before stepping back one more.
    const previous = subDays(cursor, 1)
    while (index < transactions.length && transactions[index]!.postedAt > previous) {
      value = value.minus(transactions[index]!.amount)
      index += 1
    }
    cursor = previous
  }

  return points
}

/**
 * Loans move by amortization, not by transactions in the account. Given a
 * balance, rate, and payment:
 *
 *   balance(m) = balance(m-1) × (1 + r) − payment
 *
 * so stepping backwards is balance(m-1) = (balance(m) + payment) ÷ (1 + r).
 */
function amortizeBackwards(account: Account, today: Date, days: number): SnapshotPoint[] {
  const payment = account.minimumPayment
  const apr = account.apr

  if (!payment || !apr || payment.lessThanOrEqualTo(0)) {
    return [{ asOf: today, value: account.currentBalance.abs() }]
  }

  const monthlyRate = apr.dividedBy(12)
  const months = Math.ceil(days / 30)

  const monthly: SnapshotPoint[] = []
  let balance = account.currentBalance.abs()

  for (let month = 0; month <= months; month += 1) {
    monthly.push({ asOf: startOfDay(addMonths(today, -month)), value: balance })
    balance = balance.plus(payment).dividedBy(monthlyRate.plus(1))

    // An original principal is a hard ceiling — a reconstruction that walks past
    // it has left the realm of arithmetic.
    if (account.originalPrincipal && balance.greaterThan(account.originalPrincipal)) {
      balance = account.originalPrincipal
    }
  }

  return interpolateDaily(monthly, today, days)
}

/** Straight-line fill between monthly points, so the trend line is smooth. */
function interpolateDaily(monthly: SnapshotPoint[], today: Date, days: number): SnapshotPoint[] {
  const points: SnapshotPoint[] = []

  for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
    const date = startOfDay(subDays(today, dayOffset))
    const monthsBack = Math.abs(differenceInCalendarMonths(date, today))

    const before = monthly[Math.min(monthsBack, monthly.length - 1)]
    const after = monthly[Math.min(monthsBack + 1, monthly.length - 1)]
    if (!before || !after) continue

    // Fraction of the way from the newer monthly point to the older one.
    const anchor = addMonths(today, -monthsBack)
    const spanDays = 30
    const elapsed = Math.min(spanDays, Math.abs((anchor.getTime() - date.getTime()) / 86_400_000))
    const ratio = elapsed / spanDays

    points.push({
      asOf: date,
      value: before.value.plus(after.value.minus(before.value).times(ratio)),
    })
  }

  return points
}
