import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext, loadNetWorthTrend, monthsInRange } from '@/lib/services/dashboard'
import { listInsights } from '@/lib/services/insights'
import {
  computeIncomeExpense,
  monthlySeries,
  spendingByCategory,
  withinRange,
} from '@/lib/finance/cash-flow'
import { computeNetWorth } from '@/lib/finance/net-worth'
import { formatMoney, formatMoneyWhole, formatPercent, percentChange } from '@/lib/finance/money'
import { describeRange, monthBuckets } from '@/lib/finance/periods'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card, CardHeader, Delta, Figure, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { NetWorthTrend } from '@/components/charts/net-worth-trend'
import { CashFlowChart } from '@/components/charts/cash-flow-chart'
import { CategoryBars } from '@/components/charts/category-bars'
import { InsightList } from '@/components/finance/insight-list'

export const dynamic = 'force-dynamic'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const [context, trend, insights] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    loadNetWorthTrend(scope, 12),
    listInsights(scope),
  ])

  const current = computeIncomeExpense(context.transactions)
  const previous = computeIncomeExpense(withinRange(context.trendTransactions, filters.previousRange))
  const position = computeNetWorth(context.accounts)

  const categories = spendingByCategory(context.transactions)
  const previousCategories = new Map(
    spendingByCategory(withinRange(context.trendTransactions, filters.previousRange)).map((row) => [
      row.categoryId ?? row.categoryName,
      row.total,
    ]),
  )

  const series = monthlySeries(
    context.trendTransactions,
    monthBuckets({ start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now }),
  )

  const months = monthsInRange(filters.range)

  return (
    <>
      <FilterBar
        entities={context.entities}
        title="Reports"
        description={describeRange(filters.range)}
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Figure
              label="Income"
              value={formatMoneyWhole(current.income)}
              delta={<Delta value={percentChange(current.income, previous.income)} />}
            />
          </Card>
          <Card>
            <Figure
              label="Expenses"
              value={formatMoneyWhole(current.expenses)}
              delta={<Delta value={percentChange(current.expenses, previous.expenses)} invert />}
            />
          </Card>
          <Card>
            <Figure
              label="Net"
              value={formatMoneyWhole(current.net)}
              tone={current.net.isNegative() ? 'negative' : 'positive'}
            />
            <p className="mt-1.5 text-xs text-muted">
              {formatMoney(current.net.dividedBy(months))} a month over {months} month
              {months === 1 ? '' : 's'}
            </p>
          </Card>
          <Card>
            <Figure label="Net worth" value={formatMoneyWhole(position.combined.netWorth)} />
            <p className="mt-1.5 text-xs text-muted">
              {formatMoney(position.personal.netWorth)} personal ·{' '}
              {formatMoney(position.business.netWorth)} business
            </p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader title="Net worth" subtitle="Last 12 months" />
            <NetWorthTrend data={trend} />
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Income and expenses" subtitle="Last 12 months" />
            <CashFlowChart data={series} />
          </Card>
        </div>

        <section>
          <SectionTitle>Spending by category</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Card>
              <CardHeader title="Largest categories" subtitle={describeRange(filters.range)} />
              <CategoryBars
                rows={categories.map((row) => ({
                  categoryId: row.categoryId,
                  categoryName: row.categoryName,
                  total: row.total.toFixed(2),
                  transactionCount: row.transactionCount,
                  shareOfTotal: row.shareOfTotal,
                }))}
                limit={10}
              />
            </Card>

            <Card>
              <CardHeader title="Period over period" subtitle="Against the previous period of equal length" />
              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th align="right">This period</Th>
                    <Th align="right">Previous</Th>
                    <Th align="right">Change</Th>
                    <Th align="right">Share</Th>
                  </tr>
                </thead>
                <tbody>
                  {categories.slice(0, 14).map((row) => {
                    const before = previousCategories.get(row.categoryId ?? row.categoryName)
                    return (
                      <tr key={row.categoryId ?? row.categoryName}>
                        <Td>{row.categoryName}</Td>
                        <Td align="right" numeric className="font-medium">
                          {formatMoney(row.total)}
                        </Td>
                        <Td align="right" numeric>
                          {before ? formatMoney(before) : '—'}
                        </Td>
                        <Td align="right">
                          <Delta value={before ? percentChange(row.total, before) : null} invert />
                        </Td>
                        <Td align="right" numeric>
                          {formatPercent(row.shareOfTotal, 0)}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle>Insights</SectionTitle>
          <Card>
            <InsightList insights={insights} />
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              Insights are generated by a deterministic rules engine over the figures on this page — the
              same inputs, the same thresholds, the same answer every time. They state observations and
              arithmetic; deciding what to do about them is yours.
            </p>
          </Card>
        </section>
      </div>
    </>
  )
}
