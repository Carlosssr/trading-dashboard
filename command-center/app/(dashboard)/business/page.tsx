import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext, monthsInRange } from '@/lib/services/dashboard'
import { computeEntityPerformance, totalAcrossEntities } from '@/lib/finance/pnl'
import { monthlySeries } from '@/lib/finance/cash-flow'
import { isCash, isLiability } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatPercent, money, sumBy } from '@/lib/finance/money'
import { describeRange, monthBuckets } from '@/lib/finance/periods'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card, CardHeader, Delta, Dot, EmptyState, Figure, KeyValue, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { CashFlowChart } from '@/components/charts/cash-flow-chart'

export const dynamic = 'force-dynamic'

export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const context = await loadFinancialContext(scope, filters, now)

  const entities = context.entities.filter((entity) => entity.ledger === 'BUSINESS')

  const performances = entities.map((entity) =>
    computeEntityPerformance({
      entityId: entity.id,
      entityName: entity.name,
      transactions: context.trendTransactions,
      range: filters.range,
      previousRange: filters.previousRange,
      cashBalance: sumBy(
        context.accounts.filter(
          (account) => account.entityId === entity.id && !account.isClosed && isCash(account.type),
        ),
        (account) => account.currentBalance,
      ),
      businessDebt: sumBy(
        context.accounts.filter((account) => account.entityId === entity.id && !account.isClosed),
        (account) => (isLiability(account.type) ? money(account.currentBalance).abs() : 0),
      ),
      monthsInRange: monthsInRange(filters.range),
    }),
  )

  const totals = totalAcrossEntities(performances)

  const businessSeries = monthlySeries(
    context.trendTransactions.filter((transaction) => transaction.ledger === 'BUSINESS'),
    monthBuckets({ start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now }),
  )

  return (
    <>
      <FilterBar
        entities={context.entities}
        title="Business"
        description={`${entities.length} business entities · ${describeRange(filters.range)}`}
      />

      <div className="space-y-6 px-6 py-6">
        {entities.length === 0 ? (
          <EmptyState
            title="No business entities"
            description="Create an entity on the business ledger to keep company books separate from personal ones."
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card>
                <Figure label="Revenue" value={formatMoneyWhole(totals.revenue)} />
              </Card>
              <Card>
                <Figure label="Operating expenses" value={formatMoneyWhole(totals.expenses)} />
              </Card>
              <Card>
                <Figure
                  label="Net operating income"
                  value={formatMoneyWhole(totals.netIncome)}
                  tone={totals.netIncome.isNegative() ? 'negative' : 'positive'}
                />
              </Card>
              <Card>
                <Figure label="Business cash" value={formatMoneyWhole(totals.cash)} />
              </Card>
              <Card>
                <Figure label="Business debt" value={formatMoneyWhole(totals.debt)} />
              </Card>
            </div>

            <Card className="min-w-0">
              <CardHeader
                title="Business income and expenses"
                subtitle="Last 12 months, business ledger only"
              />
              <CashFlowChart data={businessSeries} />
            </Card>

            {performances.map((performance) => {
              const entity = entities.find((candidate) => candidate.id === performance.pnl.entityId)

              return (
                <section key={performance.pnl.entityId}>
                  <SectionTitle>
                    <span className="flex items-center gap-2">
                      <Dot color={entity?.color ?? 'var(--color-muted)'} />
                      {performance.pnl.entityName}
                    </span>
                  </SectionTitle>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <Card>
                      <Figure
                        label="Net operating income"
                        value={formatMoney(performance.pnl.netOperatingIncome)}
                        tone={performance.pnl.netOperatingIncome.isNegative() ? 'negative' : 'positive'}
                        delta={<Delta value={performance.revenueChange} suffix="revenue" />}
                      />

                      <dl className="mt-4 space-y-0 border-t border-line pt-2">
                        <KeyValue label="Cash balance" value={formatMoney(performance.cashBalance)} />
                        <KeyValue label="Business debt" value={formatMoney(performance.businessDebt)} />
                        <KeyValue label="Monthly burn" value={formatMoney(performance.monthlyBurn)} />
                        <KeyValue
                          label="Profit margin"
                          value={formatPercent(performance.pnl.profitMargin, 1)}
                        />
                        <KeyValue
                          label="Runway"
                          value={
                            performance.runwayMonths === null
                              ? 'Profitable'
                              : `${performance.runwayMonths.toFixed(1)} months`
                          }
                        />
                        <KeyValue
                          label="Expenses vs prior period"
                          value={<Delta value={performance.expenseChange} invert />}
                        />
                      </dl>
                    </Card>

                    <Card>
                      <CardHeader
                        title="Profit and loss"
                        subtitle={describeRange(performance.pnl.range)}
                      />

                      <Table className="min-w-0">
                        <tbody>
                          <tr>
                            <Td className="font-medium text-primary">Revenue</Td>
                            <Td align="right" numeric className="font-medium">
                              {formatMoney(performance.pnl.revenue)}
                            </Td>
                          </tr>
                          {performance.pnl.revenueLines.slice(0, 5).map((line) => (
                            <tr key={line.categoryId ?? line.categoryName}>
                              <Td className="pl-4 text-xs">{line.categoryName}</Td>
                              <Td align="right" numeric className="text-xs">
                                {formatMoney(line.total)}
                              </Td>
                            </tr>
                          ))}

                          <tr>
                            <Td className="pt-4 font-medium text-primary">Operating expenses</Td>
                            <Td align="right" numeric className="pt-4 font-medium">
                              −{formatMoney(performance.pnl.operatingExpenses)}
                            </Td>
                          </tr>
                          {performance.pnl.expenseLines.slice(0, 8).map((line) => (
                            <tr key={line.categoryId ?? line.categoryName}>
                              <Td className="pl-4 text-xs">
                                {line.categoryName}
                                <span className="ml-1.5 text-muted">
                                  {formatPercent(line.shareOfExpenses, 0)}
                                </span>
                              </Td>
                              <Td align="right" numeric className="text-xs">
                                {formatMoney(line.total)}
                              </Td>
                            </tr>
                          ))}

                          <tr>
                            <Td className="border-t-2 border-line pt-3 text-sm font-semibold text-primary">
                              Net operating income
                            </Td>
                            <Td
                              align="right"
                              numeric
                              className="border-t-2 border-line pt-3 text-sm font-semibold"
                            >
                              {formatMoney(performance.pnl.netOperatingIncome)}
                            </Td>
                          </tr>
                        </tbody>
                      </Table>

                      {performance.pnl.transactionCount === 0 ? (
                        <p className="mt-3 text-xs text-muted">
                          No transactions for this entity in the selected period.
                        </p>
                      ) : null}
                    </Card>
                  </div>
                </section>
              )
            })}

            <Card>
              <p className="text-[11px] leading-relaxed text-muted">
                Each statement is computed from that entity&apos;s own transactions only. Totals across
                entities are the sum of the finished statements — no query mixes two sets of books before
                subtotalling, and no personal transaction reaches this page. Debt principal payments are
                balance-sheet movements and are excluded from both sides.
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
