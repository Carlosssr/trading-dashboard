import { z } from 'zod'
import type { Ledger } from '@prisma/client'
import { PERIOD_KEYS, resolvePeriod, previousPeriod, type DateRange, type PeriodKey } from '@/lib/finance/periods'

/**
 * The filter triple every dashboard page shares: ledger scope, entity, period.
 * Parsed once here so a page and its API counterpart cannot disagree about what
 * `?period=ytd` means.
 */

export const LEDGER_SCOPES = ['all', 'personal', 'business'] as const
export type LedgerScope = (typeof LEDGER_SCOPES)[number]

export const filterSchema = z.object({
  ledger: z.enum(LEDGER_SCOPES).default('all'),
  entityId: z.string().min(1).optional(),
  period: z.enum(PERIOD_KEYS).default('this-month'),
  from: z.string().optional(),
  to: z.string().optional(),
})

export type DashboardFilters = {
  ledger: LedgerScope
  entityId: string | undefined
  period: PeriodKey
  range: DateRange
  previousRange: DateRange
}

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Invalid values fall back to defaults rather than erroring — a bad query string should not 500 a dashboard. */
export function parseFilters(searchParams: SearchParams, now: Date = new Date()): DashboardFilters {
  const parsed = filterSchema.safeParse({
    ledger: firstValue(searchParams.ledger),
    entityId: firstValue(searchParams.entityId),
    period: firstValue(searchParams.period),
    from: firstValue(searchParams.from),
    to: firstValue(searchParams.to),
  })

  const values = parsed.success
    ? parsed.data
    : { ledger: 'all' as const, entityId: undefined, period: 'this-month' as const, from: undefined, to: undefined }

  const custom = {
    from: values.from ? new Date(values.from) : undefined,
    to: values.to ? new Date(values.to) : undefined,
  }

  return {
    ledger: values.ledger,
    entityId: values.entityId,
    period: values.period,
    range: resolvePeriod(values.period, now, custom),
    previousRange: previousPeriod(values.period, now, custom),
  }
}

/** `all` means "no ledger constraint", which is not the same as a value to filter on. */
export function ledgerFilter(scope: LedgerScope): Ledger | undefined {
  if (scope === 'personal') return 'PERSONAL'
  if (scope === 'business') return 'BUSINESS'
  return undefined
}

export function buildQuery(filters: Partial<Record<string, string | undefined>>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
