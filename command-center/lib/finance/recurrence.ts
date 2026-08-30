import { addDays, addMonths, differenceInCalendarDays, getDate } from 'date-fns'
import type { Cadence } from '@prisma/client'
import { money, type Money, type MoneyInput } from './money'

/**
 * Recurring-transaction detection.
 *
 * Deterministic and explainable on purpose: the user is being asked "we detected
 * a recurring $185 payment to XYZ Insurance every month — add this as a bill?",
 * so the answer has to be defensible, repeatable, and inspectable. Every
 * proposal carries the evidence (occurrence count, interval regularity, amount
 * spread) that produced its confidence score.
 */

export type RecurrenceCandidate = {
  id: string
  postedAt: Date
  amount: MoneyInput
  merchantName: string | null
  rawName: string
  accountId: string
  entityId: string
  categoryId: string | null
  isTransfer: boolean
}

export type DetectedSeries = {
  normalizedKey: string
  merchantName: string
  accountId: string
  entityId: string
  categoryId: string | null
  cadence: Cadence
  averageAmount: Money
  lastAmount: Money
  minAmount: Money
  maxAmount: Money
  lastOccurredAt: Date
  nextExpectedAt: Date | null
  dayOfMonth: number | null
  occurrenceCount: number
  confidence: number
  isIncome: boolean
  transactionIds: string[]
}

export const DETECTION = {
  /** Below this many occurrences there is not enough evidence to call it a pattern. */
  minOccurrences: 3,
  /** Proposals below this confidence are not surfaced at all. */
  minConfidence: 0.6,
  /** How far back to look. */
  lookbackDays: 400,
} as const

/**
 * Collapses the noise providers put in descriptions — store numbers, dates,
 * trailing reference ids, payment-rail prefixes — so that "SQ *BLUE BOTTLE 4471"
 * and "SQ *BLUE BOTTLE 8823" land in the same bucket.
 */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ach|pos|debit|credit|payment|pmt|purchase|recurring|autopay|web|id|ref)\b/g, ' ')
    .replace(/[*#]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CADENCE_DAYS: Record<Cadence, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  SEMIMONTHLY: 15,
  MONTHLY: 30,
  QUARTERLY: 91,
  SEMIANNUAL: 182,
  ANNUAL: 365,
  IRREGULAR: 0,
}

export function cadenceDays(cadence: Cadence): number {
  return CADENCE_DAYS[cadence]
}

/** Occurrences per year, for annualizing a recurring cost. */
export function occurrencesPerYear(cadence: Cadence): number {
  switch (cadence) {
    case 'WEEKLY':
      return 52
    case 'BIWEEKLY':
      return 26
    case 'SEMIMONTHLY':
      return 24
    case 'MONTHLY':
      return 12
    case 'QUARTERLY':
      return 4
    case 'SEMIANNUAL':
      return 2
    case 'ANNUAL':
      return 1
    case 'IRREGULAR':
      return 0
  }
}

/** Normalizes any cadence to a monthly-equivalent amount. */
export function monthlyEquivalent(amount: MoneyInput, cadence: Cadence): Money {
  const perYear = occurrencesPerYear(cadence)
  if (perYear === 0) return money(0)
  return money(amount).times(perYear).dividedBy(12)
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  SEMIMONTHLY: 'Twice a month',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Every 6 months',
  ANNUAL: 'Annually',
  IRREGULAR: 'Irregular',
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const variance = mean(values.map((v) => (v - average) ** 2))
  return Math.sqrt(variance)
}

/**
 * Semimonthly (the 1st and 15th, say) and biweekly both land near a 15-day
 * median, so they are separated by whether the days of the month repeat.
 */
function looksSemimonthly(dates: Date[]): boolean {
  if (dates.length < 4) return false
  const days = dates.map((d) => getDate(d))
  const distinct = [...new Set(days.map((d) => Math.round(d / 5) * 5))]
  return distinct.length <= 2
}

function classifyCadence(intervals: number[], dates: Date[]): Cadence {
  const typical = median(intervals)

  if (typical <= 10) return 'WEEKLY'
  if (typical <= 18) return looksSemimonthly(dates) ? 'SEMIMONTHLY' : 'BIWEEKLY'
  if (typical <= 45) return 'MONTHLY'
  if (typical <= 135) return 'QUARTERLY'
  if (typical <= 250) return 'SEMIANNUAL'
  if (typical <= 400) return 'ANNUAL'
  return 'IRREGULAR'
}

/**
 * Confidence blends three signals: how evenly spaced the occurrences are, how
 * stable the amount is, and how many times it has happened. Interval regularity
 * dominates because a subscription that changes price is still a subscription,
 * whereas evenly-priced but randomly-timed purchases are not recurring.
 */
function scoreConfidence(intervals: number[], amounts: number[], count: number): number {
  const intervalMean = mean(intervals)
  const intervalCv = intervalMean === 0 ? 1 : standardDeviation(intervals) / intervalMean
  const intervalScore = Math.max(0, 1 - intervalCv)

  const amountMean = mean(amounts)
  const amountCv = amountMean === 0 ? 1 : standardDeviation(amounts) / amountMean
  const amountScore = Math.max(0, 1 - amountCv)

  const countScore = Math.min(1, (count - 1) / 5)

  return Number((intervalScore * 0.45 + amountScore * 0.3 + countScore * 0.25).toFixed(3))
}

export function nextOccurrence(last: Date, cadence: Cadence, dayOfMonth: number | null): Date | null {
  switch (cadence) {
    case 'WEEKLY':
      return addDays(last, 7)
    case 'BIWEEKLY':
      return addDays(last, 14)
    case 'SEMIMONTHLY':
      return addDays(last, 15)
    case 'MONTHLY':
    case 'QUARTERLY':
    case 'SEMIANNUAL':
    case 'ANNUAL': {
      const monthsAhead =
        cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : cadence === 'SEMIANNUAL' ? 6 : 12
      const next = addMonths(last, monthsAhead)
      if (dayOfMonth === null) return next
      // Clamp so a bill due on the 31st lands on the last day of a short month.
      const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      return new Date(next.getFullYear(), next.getMonth(), Math.min(dayOfMonth, daysInMonth))
    }
    case 'IRREGULAR':
      return null
  }
}

/**
 * Groups transactions by merchant and account, then evaluates each group.
 * Transfers are excluded — moving money between your own accounts is regular but
 * is not a bill.
 */
export function detectRecurringSeries(
  transactions: RecurrenceCandidate[],
  now: Date,
): DetectedSeries[] {
  const cutoff = addDays(now, -DETECTION.lookbackDays)
  const groups = new Map<string, RecurrenceCandidate[]>()

  for (const transaction of transactions) {
    if (transaction.isTransfer) continue
    if (transaction.postedAt < cutoff) continue

    const key = normalizeMerchant(transaction.merchantName ?? transaction.rawName)
    if (key.length < 3) continue

    const groupKey = `${key}::${transaction.accountId}`
    const existing = groups.get(groupKey)
    if (existing) existing.push(transaction)
    else groups.set(groupKey, [transaction])
  }

  const series: DetectedSeries[] = []

  for (const [groupKey, group] of groups) {
    if (group.length < DETECTION.minOccurrences) continue

    const ordered = [...group].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime())
    const dates = ordered.map((t) => t.postedAt)

    const intervals: number[] = []
    for (let i = 1; i < dates.length; i += 1) {
      const days = differenceInCalendarDays(dates[i]!, dates[i - 1]!)
      // Two charges on the same day are one event split by the merchant, not a
      // one-day cadence.
      if (days > 0) intervals.push(days)
    }
    if (intervals.length < DETECTION.minOccurrences - 1) continue

    const amounts = ordered.map((t) => money(t.amount).abs().toNumber())
    const cadence = classifyCadence(intervals, dates)
    if (cadence === 'IRREGULAR') continue

    const confidence = scoreConfidence(intervals, amounts, ordered.length)
    if (confidence < DETECTION.minConfidence) continue

    const last = ordered[ordered.length - 1]!
    const dayOfMonth =
      cadence === 'MONTHLY' || cadence === 'QUARTERLY' || cadence === 'ANNUAL' || cadence === 'SEMIANNUAL'
        ? Math.round(median(dates.map((d) => getDate(d))))
        : null

    const normalizedKey = groupKey.split('::')[0] ?? ''
    const total = amounts.reduce((a, b) => a + b, 0)

    series.push({
      normalizedKey,
      merchantName: last.merchantName ?? last.rawName,
      accountId: last.accountId,
      entityId: last.entityId,
      categoryId: last.categoryId,
      cadence,
      averageAmount: money(total / amounts.length),
      lastAmount: money(Math.abs(money(last.amount).toNumber())),
      minAmount: money(Math.min(...amounts)),
      maxAmount: money(Math.max(...amounts)),
      lastOccurredAt: last.postedAt,
      nextExpectedAt: nextOccurrence(last.postedAt, cadence, dayOfMonth),
      dayOfMonth,
      occurrenceCount: ordered.length,
      confidence,
      isIncome: money(last.amount).greaterThan(0),
      transactionIds: ordered.map((t) => t.id),
    })
  }

  return series.sort((a, b) => b.confidence - a.confidence)
}

export type RecurringTotals = {
  monthly: Money
  annual: Money
  seriesCount: number
}

export function totalRecurring(
  series: { averageAmount: MoneyInput; cadence: Cadence }[],
): RecurringTotals {
  const monthly = series.reduce<Money>(
    (total, s) => total.plus(monthlyEquivalent(s.averageAmount, s.cadence)),
    money(0),
  )
  return { monthly, annual: monthly.times(12), seriesCount: series.length }
}
