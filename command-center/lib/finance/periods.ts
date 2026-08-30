import {
  addMonths,
  endOfDay,
  endOfMonth,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
  format,
} from 'date-fns'

/**
 * The period filter shared by every dashboard page. All functions take `now`
 * explicitly so date logic is testable and a server/client clock mismatch cannot
 * produce two different "this month"s within one render.
 */

export const PERIOD_KEYS = ['this-month', 'last-month', 'ytd', 'last-12-months', 'custom'] as const
export type PeriodKey = (typeof PERIOD_KEYS)[number]

export type DateRange = { start: Date; end: Date }

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  'this-month': 'This Month',
  'last-month': 'Last Month',
  ytd: 'Year to Date',
  'last-12-months': 'Last 12 Months',
  custom: 'Custom',
}

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return value !== undefined && (PERIOD_KEYS as readonly string[]).includes(value)
}

export function resolvePeriod(
  key: PeriodKey,
  now: Date,
  custom?: { from?: Date; to?: Date },
): DateRange {
  switch (key) {
    case 'this-month':
      return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'last-month': {
      const previous = subMonths(now, 1)
      return { start: startOfMonth(previous), end: endOfMonth(previous) }
    }
    case 'ytd':
      return { start: startOfYear(now), end: endOfDay(now) }
    case 'last-12-months':
      return { start: startOfMonth(subMonths(now, 11)), end: endOfMonth(now) }
    case 'custom':
      return {
        start: startOfDay(custom?.from ?? startOfMonth(now)),
        end: endOfDay(custom?.to ?? now),
      }
  }
}

/**
 * The immediately preceding window of the same length, used for every
 * period-over-period comparison on the dashboard.
 */
export function previousPeriod(key: PeriodKey, now: Date, custom?: { from?: Date; to?: Date }): DateRange {
  switch (key) {
    case 'this-month':
    case 'last-month': {
      const anchor = key === 'this-month' ? subMonths(now, 1) : subMonths(now, 2)
      return { start: startOfMonth(anchor), end: endOfMonth(anchor) }
    }
    case 'ytd': {
      const lastYear = subYears(now, 1)
      return { start: startOfYear(lastYear), end: lastYear }
    }
    case 'last-12-months':
      return { start: startOfMonth(subMonths(now, 23)), end: endOfMonth(subMonths(now, 12)) }
    case 'custom': {
      const current = resolvePeriod('custom', now, custom)
      const span = current.end.getTime() - current.start.getTime()
      return { start: new Date(current.start.getTime() - span), end: current.start }
    }
  }
}

export function monthToDate(now: Date): DateRange {
  return { start: startOfMonth(now), end: endOfDay(now) }
}

export function yearToDate(now: Date): DateRange {
  return { start: startOfYear(now), end: endOfDay(now) }
}

export function fullYear(now: Date): DateRange {
  return { start: startOfYear(now), end: endOfYear(now) }
}

/** Month buckets covering a range, oldest first. Used for trend charts. */
export function monthBuckets(range: DateRange): { start: Date; end: Date; label: string; key: string }[] {
  const buckets: { start: Date; end: Date; label: string; key: string }[] = []
  let cursor = startOfMonth(range.start)

  while (cursor <= range.end) {
    buckets.push({
      start: startOfMonth(cursor),
      end: endOfMonth(cursor),
      label: format(cursor, 'MMM'),
      key: format(cursor, 'yyyy-MM'),
    })
    cursor = addMonths(cursor, 1)
  }
  return buckets
}

export function quarterOf(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

export function describeRange(range: DateRange): string {
  return `${format(range.start, 'MMM d, yyyy')} – ${format(range.end, 'MMM d, yyyy')}`
}
