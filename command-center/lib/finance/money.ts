import Decimal from 'decimal.js-light'

/**
 * Money is exact decimal arithmetic end to end. It becomes a `number` only in
 * the formatting helpers at the bottom of this file, which is the render
 * boundary — never in a calculation.
 *
 * The decimal type comes from `decimal.js-light` rather than from
 * `@prisma/client/runtime/library`. Both are the same library, but the Prisma
 * copy drags the Prisma runtime — and `node:module` with it — into any bundle
 * that touches it, so a client component formatting a figure would break the
 * build. Importing the library directly is what actually makes this module
 * isomorphic, as the rest of lib/finance claims to be.
 */
export type Money = Decimal

/**
 * Accepts Prisma's `Decimal` too. It is a structurally identical class from a
 * separate copy of the same library, so `instanceof` is false for it and it is
 * normalized through its string form instead.
 */
export type DecimalLike = { toFixed(decimalPlaces?: number): string }
export type MoneyInput = Decimal | DecimalLike | number | string | null | undefined

export const ZERO = new Decimal(0)

export function money(value: MoneyInput): Money {
  if (value === null || value === undefined) return ZERO
  if (value instanceof Decimal) return value
  if (typeof value === 'number' || typeof value === 'string') return new Decimal(value)
  // A Prisma Decimal (or anything else decimal-shaped): go through its exact
  // decimal string, never through a float.
  return new Decimal(value.toFixed())
}

export function sum(values: MoneyInput[]): Money {
  return values.reduce<Money>((total, value) => total.plus(money(value)), ZERO)
}

export function sumBy<T>(items: T[], select: (item: T) => MoneyInput): Money {
  return items.reduce<Money>((total, item) => total.plus(money(select(item))), ZERO)
}

export function isZero(value: MoneyInput): boolean {
  return money(value).isZero()
}

export function abs(value: MoneyInput): Money {
  return money(value).abs()
}

export function negate(value: MoneyInput): Money {
  return money(value).negated()
}

/**
 * Percentage change from `previous` to `current`, as a ratio (0.18 = +18%).
 * Returns null when there is no baseline, because "up 100%" from zero is
 * meaningless and rendering it as a real trend would mislead.
 */
export function percentChange(current: MoneyInput, previous: MoneyInput): number | null {
  const base = money(previous)
  if (base.isZero()) return null
  return money(current).minus(base).dividedBy(base.abs()).toNumber()
}

/** Ratio of part to whole, clamped at zero when the whole is zero or negative. */
export function ratio(part: MoneyInput, whole: MoneyInput): number {
  const denominator = money(whole)
  if (denominator.lessThanOrEqualTo(0)) return 0
  return money(part).dividedBy(denominator).toNumber()
}

// --- Formatting (the render boundary) --------------------------------------

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const wholeFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatMoney(value: MoneyInput): string {
  return currencyFormatter.format(money(value).toNumber())
}

export function formatMoneyWhole(value: MoneyInput): string {
  return wholeFormatter.format(money(value).toNumber())
}

export function formatCompact(value: MoneyInput): string {
  return compactFormatter.format(money(value).toNumber())
}

/** Signed, for deltas: "+$1,240.00" / "-$310.50". */
export function formatSigned(value: MoneyInput): string {
  const amount = money(value)
  const formatted = currencyFormatter.format(amount.abs().toNumber())
  if (amount.isZero()) return formatted
  return `${amount.isNegative() ? '-' : '+'}${formatted}`
}

/** `rate` is a decimal ratio: 0.1899 renders as "18.99%". */
export function formatPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(digits)}%`
}

export function formatSignedPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(digits)}%`
}

/** Plain number for chart libraries, which cannot consume Decimal. */
export function toNumber(value: MoneyInput): number {
  return money(value).toNumber()
}

export { Decimal }
