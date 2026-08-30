import { differenceInCalendarDays, endOfMonth, startOfMonth } from 'date-fns'
import type { Cadence, Ledger, OccurrenceStatus } from '@prisma/client'
import { money, sumBy, ZERO, type Money, type MoneyInput } from './money'
import { monthlyEquivalent } from './recurrence'

/**
 * Bill Pay arithmetic and status logic.
 *
 * The one rule that shapes everything here: a bill is only *paid* when something
 * outside the UI says so — a matched transaction, a provider-confirmed payment,
 * or an explicit "mark paid" by a person. A scheduled payment is not a paid
 * bill, and this module never treats it as one.
 */

export type BillOccurrenceInput = {
  id: string
  billId: string
  billName: string
  payeeName: string
  dueAt: Date
  amountDue: MoneyInput
  status: OccurrenceStatus
  autopay: boolean
  ledger: Ledger
  entityId: string
  entityName: string
  categoryName: string | null
  fundingAccountName: string | null
  fundingAccountMask: string | null
  paidAt: Date | null
  paidAmount: MoneyInput | null
}

/** The status indicators the brief specifies, in the order they take precedence. */
export type BillIndicator = 'paid' | 'overdue' | 'due-soon' | 'autopay' | 'upcoming'

export const INDICATOR_META: Record<BillIndicator, { label: string; dot: string }> = {
  overdue: { label: 'Overdue', dot: '⚠️' },
  'due-soon': { label: 'Due soon', dot: '🔴' },
  upcoming: { label: 'Upcoming', dot: '🟡' },
  paid: { label: 'Paid', dot: '🟢' },
  autopay: { label: 'Autopay', dot: '🔵' },
}

export const DUE_SOON_DAYS = 3

/**
 * Paid wins over everything — a paid bill is never also overdue. Overdue beats
 * autopay, because an autopay that did not land is exactly what needs attention.
 */
export function billIndicator(occurrence: BillOccurrenceInput, now: Date): BillIndicator {
  if (occurrence.status === 'PAID') return 'paid'
  if (occurrence.status === 'SKIPPED') return 'upcoming'

  const daysAway = differenceInCalendarDays(occurrence.dueAt, now)
  if (daysAway < 0) return 'overdue'
  if (occurrence.autopay) return 'autopay'
  if (daysAway <= DUE_SOON_DAYS) return 'due-soon'
  return 'upcoming'
}

export type UpcomingBuckets = {
  dueInThreeDays: BillOccurrenceInput[]
  dueThisWeek: BillOccurrenceInput[]
  dueThisMonth: BillOccurrenceInput[]
  overdue: BillOccurrenceInput[]
}

/**
 * Buckets are cumulative windows, not exclusive slices: something due tomorrow
 * appears in all three, because "due this month" should total every unpaid bill
 * left in the month. The UI labels them as windows for that reason.
 */
export function bucketUpcoming(occurrences: BillOccurrenceInput[], now: Date): UpcomingBuckets {
  const unpaid = occurrences.filter((o) => o.status !== 'PAID' && o.status !== 'SKIPPED')
  const monthEnd = endOfMonth(now)

  return {
    overdue: unpaid.filter((o) => differenceInCalendarDays(o.dueAt, now) < 0),
    dueInThreeDays: unpaid.filter((o) => {
      const days = differenceInCalendarDays(o.dueAt, now)
      return days >= 0 && days <= 3
    }),
    dueThisWeek: unpaid.filter((o) => {
      const days = differenceInCalendarDays(o.dueAt, now)
      return days >= 0 && days <= 7
    }),
    dueThisMonth: unpaid.filter((o) => o.dueAt >= now && o.dueAt <= monthEnd),
  }
}

export type BillPaySummary = {
  billsDueThisMonth: number
  amountDueThisMonth: Money
  dueNextSevenDays: Money
  dueNextThirtyDays: Money
  paidThisMonth: Money
  paidCount: number
  outstanding: Money
  outstandingCount: number
  autopayCount: number
  manualCount: number
  overdueCount: number
  overdueAmount: Money
}

export function summarizeBillPay(occurrences: BillOccurrenceInput[], now: Date): BillPaySummary {
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const thisMonth = occurrences.filter((o) => o.dueAt >= monthStart && o.dueAt <= monthEnd)
  const paid = thisMonth.filter((o) => o.status === 'PAID')
  const outstanding = thisMonth.filter((o) => o.status !== 'PAID' && o.status !== 'SKIPPED')

  const withinDays = (days: number) =>
    occurrences.filter((o) => {
      if (o.status === 'PAID' || o.status === 'SKIPPED') return false
      const away = differenceInCalendarDays(o.dueAt, now)
      return away >= 0 && away <= days
    })

  const overdue = occurrences.filter(
    (o) => o.status !== 'PAID' && o.status !== 'SKIPPED' && differenceInCalendarDays(o.dueAt, now) < 0,
  )

  return {
    billsDueThisMonth: thisMonth.length,
    amountDueThisMonth: sumBy(thisMonth, (o) => o.amountDue),
    dueNextSevenDays: sumBy(withinDays(7), (o) => o.amountDue),
    dueNextThirtyDays: sumBy(withinDays(30), (o) => o.amountDue),
    paidThisMonth: sumBy(paid, (o) => o.paidAmount ?? o.amountDue),
    paidCount: paid.length,
    outstanding: sumBy(outstanding, (o) => o.amountDue),
    outstandingCount: outstanding.length,
    autopayCount: outstanding.filter((o) => o.autopay).length,
    manualCount: outstanding.filter((o) => !o.autopay).length,
    overdueCount: overdue.length,
    overdueAmount: sumBy(overdue, (o) => o.amountDue),
  }
}

export type CalendarDay = {
  date: Date
  inMonth: boolean
  isToday: boolean
  occurrences: BillOccurrenceInput[]
  total: Money
}

/**
 * A six-week grid covering the month, Sunday-first — always 42 cells so the
 * calendar does not change height between months.
 */
export function buildCalendar(
  occurrences: BillOccurrenceInput[],
  month: Date,
  today: Date,
): CalendarDay[] {
  const firstOfMonth = startOfMonth(month)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const byDay = new Map<string, BillOccurrenceInput[]>()
  for (const occurrence of occurrences) {
    const key = dayKey(occurrence.dueAt)
    const existing = byDay.get(key)
    if (existing) existing.push(occurrence)
    else byDay.set(key, [occurrence])
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const dayOccurrences = byDay.get(dayKey(date)) ?? []

    return {
      date,
      inMonth: date.getMonth() === firstOfMonth.getMonth(),
      isToday: dayKey(date) === dayKey(today),
      occurrences: dayOccurrences,
      total: sumBy(dayOccurrences, (o) => o.amountDue),
    }
  })
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * Recurring cost of the active bills, normalized to monthly and annual figures.
 */
export function recurringBillTotals(
  bills: { expectedAmount: MoneyInput; cadence: Cadence; ledger: Ledger }[],
): { monthly: Money; annual: Money; personalMonthly: Money; businessMonthly: Money } {
  const monthlyFor = (ledger: Ledger) =>
    bills
      .filter((b) => b.ledger === ledger)
      .reduce<Money>((total, b) => total.plus(monthlyEquivalent(b.expectedAmount, b.cadence)), ZERO)

  const personalMonthly = monthlyFor('PERSONAL')
  const businessMonthly = monthlyFor('BUSINESS')
  const monthly = personalMonthly.plus(businessMonthly)

  return { monthly, annual: monthly.times(12), personalMonthly, businessMonthly }
}

/**
 * Cash-flow protection: would this payment take the funding account below the
 * reserve the user set? Returns a warning sentence, or null when it is fine.
 */
export function cashReserveWarning(input: {
  availableBalance: MoneyInput
  paymentAmount: MoneyInput
  minimumReserve: MoneyInput | null
}): string | null {
  if (input.minimumReserve === null || input.minimumReserve === undefined) return null

  const reserve = money(input.minimumReserve)
  if (reserve.lessThanOrEqualTo(0)) return null

  const projected = money(input.availableBalance).minus(money(input.paymentAmount))
  if (projected.greaterThanOrEqualTo(reserve)) return null

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  if (projected.lessThan(0)) {
    return `This payment exceeds the available balance in the funding account by ${formatted.format(
      projected.abs().toNumber(),
    )}.`
  }

  return `This payment may reduce available cash below your ${formatted.format(
    reserve.toNumber(),
  )} minimum cash threshold.`
}
