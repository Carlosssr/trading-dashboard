'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import {
  AXIS,
  GRID,
  Legend,
  TooltipRow,
  TooltipShell,
  formatAxisMoney,
  formatTooltipMoney,
} from './chart-chrome'

/**
 * Income against expenses by month.
 *
 * Two series on one shared y-axis — never a second axis. Bars are separated by a
 * 2px surface gap and the pair is direct-labelled through the legend, which is
 * always present for two or more series.
 */

export type FlowPoint = {
  key: string
  label: string
  income: number
  expenses: number
  net: number
}

const SERIES = [
  { key: 'income', label: 'Income', color: 'var(--color-series-1)' },
  { key: 'expenses', label: 'Expenses', color: 'var(--color-series-2)' },
] as const

export function CashFlowChart({ data }: { data: FlowPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-muted">
        No transactions in this period.
      </div>
    )
  }

  return (
    <div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} width={58} tickFormatter={formatAxisMoney} />
            <Tooltip cursor={{ fill: 'var(--color-sunken)' }} content={<FlowTooltip />} />

            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                fill={series.color}
                // Rounded data-ends, anchored to the baseline.
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3">
        <Legend items={SERIES.map((series) => ({ color: series.color, label: series.label }))} />
      </div>
    </div>
  )
}

function FlowTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as FlowPoint | undefined
  if (!point) return null

  return (
    <TooltipShell title={point.label}>
      {SERIES.map((series) => (
        <TooltipRow
          key={series.key}
          color={series.color}
          label={series.label}
          value={formatTooltipMoney(point[series.key])}
        />
      ))}
      <div className="mt-1 border-t border-line pt-1">
        <TooltipRow label="Net" value={formatTooltipMoney(point.net)} />
      </div>
    </TooltipShell>
  )
}
