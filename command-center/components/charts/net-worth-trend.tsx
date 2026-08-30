'use client'

import { format, parseISO } from 'date-fns'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { AXIS, GRID, TooltipRow, TooltipShell, formatAxisMoney, formatTooltipMoney } from './chart-chrome'

/**
 * Net worth over time.
 *
 * One series, so no legend — the card title names it. The tooltip carries
 * assets and liabilities alongside so the reader can see what moved the line
 * without a second chart or a second y-axis.
 */

export type NetWorthPoint = {
  date: string
  assets: number
  liabilities: number
  netWorth: number
}

export function NetWorthTrend({ data }: { data: NetWorthPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-muted">
        A trend appears once there are at least two days of balance history.
      </div>
    )
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-series-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="date"
            {...AXIS}
            tickFormatter={(value: string) => format(parseISO(value), 'MMM d')}
            minTickGap={40}
          />
          <YAxis {...AXIS} width={58} tickFormatter={formatAxisMoney} />
          <Tooltip
            cursor={{ stroke: 'var(--color-line-strong)', strokeWidth: 1 }}
            content={<NetWorthTooltip />}
          />

          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="var(--color-series-1)"
            strokeWidth={2}
            fill="url(#netWorthFill)"
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function NetWorthTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as NetWorthPoint | undefined
  if (!point) return null

  return (
    <TooltipShell title={format(parseISO(String(label)), 'MMMM d, yyyy')}>
      <TooltipRow color="var(--color-series-1)" label="Net worth" value={formatTooltipMoney(point.netWorth)} />
      <TooltipRow label="Assets" value={formatTooltipMoney(point.assets)} />
      <TooltipRow label="Liabilities" value={formatTooltipMoney(point.liabilities)} />
    </TooltipShell>
  )
}
