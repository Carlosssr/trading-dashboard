import { formatMoney, formatPercent } from '@/lib/finance/money'

/**
 * Spending by category.
 *
 * One measure across categories, so every bar is the same hue — colour is not
 * carrying identity here, position and the direct label are. Built in plain HTML
 * rather than a chart library: it stays readable at any width, every value is
 * already a visible label, and it needs no client JavaScript.
 */

export type CategoryRow = {
  categoryId: string | null
  categoryName: string
  total: string
  transactionCount: number
  shareOfTotal: number
}

export function CategoryBars({ rows, limit = 8 }: { rows: CategoryRow[]; limit?: number }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">No spending in this period.</p>
  }

  const shown = rows.slice(0, limit)
  const largest = Math.max(...shown.map((row) => Number(row.total)), 1)

  return (
    <ul className="space-y-2.5">
      {shown.map((row) => (
        <li key={row.categoryId ?? row.categoryName}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-secondary">{row.categoryName}</span>
            <span className="tabular shrink-0 text-xs font-medium text-primary">
              {formatMoney(row.total)}
              <span className="ml-1.5 font-normal text-muted">{formatPercent(row.shareOfTotal, 0)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full rounded-full bg-series-1"
              style={{ width: `${Math.max(2, (Number(row.total) / largest) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
