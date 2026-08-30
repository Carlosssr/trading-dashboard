'use client'

import type { ReactNode } from 'react'

/**
 * Shared chart chrome: the tooltip shell, axis styling constants, and the
 * legend. Kept in one place so every chart in the application reads as one
 * system rather than as several.
 */

export const AXIS = {
  stroke: 'var(--color-line-strong)',
  tick: { fill: 'var(--color-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const

export const GRID = {
  stroke: 'var(--color-grid)',
  strokeDasharray: '0',
  vertical: false,
} as const

export function TooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-[11px] font-medium text-muted">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function TooltipRow({
  color,
  label,
  value,
}: {
  color?: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-6 text-xs">
      <span className="flex items-center gap-1.5 text-secondary">
        {color ? (
          <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
        ) : null}
        {label}
      </span>
      <span className="tabular font-medium text-primary">{value}</span>
    </div>
  )
}

/** Identity is never colour-alone: the swatch always ships with its label. */
export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-secondary">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatAxisMoney(value: number): string {
  return compact.format(value)
}

const full = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatTooltipMoney(value: number): string {
  return full.format(value)
}
