import Link from 'next/link'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext, loadNetWorthTrend, monthsInRange } from '@/lib/services/dashboard'
import { listInsights } from '@/lib/services/insights'
import { listProperties, toCalculationInput } from '@/lib/services/properties'
import { computeCashByLedger, computeNetWorth } from '@/lib/finance/net-worth'
import { summarizeDebt, debtToIncome } from '@/lib/finance/debt'
import {
  compareCashFlow,
  computeIncomeExpense,
  estimateMonthlyIncome,
  monthlySeries,
  spendingByCategory,
  withinRange,
} from '@/lib/finance/cash-flow'
import { computeEntityPerformance } from '@/lib/finance/pnl'
import { computePortfolio } from '@/lib/finance/real-estate'
import { bucketUpcoming, recurringBillTotals } from '@/lib/finance/bills'
import { totalRecurring } from '@/lib/finance/recurrence'
import { formatMoney, formatMoneyWhole, formatPercent, money, sumBy } from '@/lib/finance/money'
import { monthBuckets, describeRange, yearToDate, monthToDate } from '@/lib/finance/periods'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card, CardHeader, Delta, Dot, Figure, KeyValue, Meter, SectionTitle } from '@/components/ui/primitives'
import { NetWorthTrend } from '@/components/charts/net-worth-trend'
import { CashFlowChart } from '@/components/charts/cash-flow-chart'
import { CategoryBars } from '@/components/charts/category-bars'
import { DebtTable } from '@/components/finance/debt-table'
import { InsightList } from '@/components/finance/insight-list'
import { UpcomingList } from '@/components/finance/upcoming-list'

// Balances and bill dates change under the page; nothing here should be
// prerendered at build time.
export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const [context, trend, properties, insights] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    loadNetWorthTrend(scope, 12),
    listProperties(scope),
    listInsights(scope),
  ])

  // --- Position ----------------------------------------------------------
  const position = computeNetWorth(context.accounts)
  const cash = computeCashByLedger(context.accounts)
  const debt = summarizeDebt(context.accounts)

  const scopeLabel =
    filters.ledger === 'personal' ? 'Personal' : filters.ledger === 'business' ? 'Business' : 'Combined'
  const headline =
    filters.ledger === 'personal'
      ? position.personal
      : filters.ledger === 'business'
        ? position.business
        : position.combined

  // --- Flow --------------------------------------------------------------
  const monthFlow = compareCashFlow(
    context.trendTransactions,
    monthToDate(now),
    { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) },
  )
  const ytdFlow = compareCashFlow(context.trendTransactions, yearToDate(now), filters.previousRange)
  const periodIncomeExpense = computeIncomeExpense(context.transactions)

  const series = monthlySeries(context.trendTransactions, monthBuckets({ start: filters.range.start, end: filters.range.end }))
  const twelveMonthSeries = monthlySeries(
    context.trendTransactions,
    monthBuckets({ start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now }),
  )

  // --- Bills and recurring ------------------------------------------------
  const upcoming = bucketUpcoming(context.occurrences, now)
  const confirmedSeries = context.recurringSeries.filter((item) => item.status === 'CONFIRMED')
  const recurring = totalRecurring(confirmedSeries)
  // Split by ledger from the series themselves. Summing bill *occurrences* would
  // count every dated instance in the materialized horizon, not one month of
  // committed cost.
  const billTotals = recurringBillTotals(
    confirmedSeries.map((item) => ({
      expectedAmount: item.averageAmount,
      cadence: item.cadence,
      ledger: item.ledger,
    })),
  )

  // --- Business -----------------------------------------------------------
  // Rental-property entities are on the business ledger but their economics are
  // rent and equity, not revenue and operating expenses — they belong to the
  // real-estate section, and a P&L card of zeroes for each one is noise.
  const businessEntities = context.entities.filter(
    (entity) => entity.ledger === 'BUSINESS' && entity.kind !== 'RENTAL_PROPERTY',
  )
  const performances = businessEntities.map((entity) =>
    computeEntityPerformance({
      entityId: entity.id,
      entityName: entity.name,
      transactions: context.trendTransactions,
      range: filters.range,
      previousRange: filters.previousRange,
      cashBalance: sumBy(
        context.accounts.filter(
          (account) =>
            account.entityId === entity.id &&
            !account.isClosed &&
            ['CHECKING', 'SAVINGS', 'MONEY_MARKET'].includes(account.type),
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

  // --- Real estate --------------------------------------------------------
  const portfolio = computePortfolio(properties.map(toCalculationInput))

  // --- Debt-to-income -----------------------------------------------------
  const monthlyIncome = estimateMonthlyIncome(
    withinRange(context.trendTransactions, { start: new Date(now.getFullYear(), now.getMonth() - 5, 1), end: now }),
    6,
  )
  const dti = monthlyIncome ? debtToIncome(debt.totalMinimumPayments, monthlyIncome) : null

  return (
    <>
      <FilterBar
        entities={context.entities}
        title="Dashboard"
        description={describeRange(filters.range)}
      />

      <div className="space-y-8 px-6 py-6">
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="position-heading">
          <SectionTitle>
            <span id="position-heading">Total financial position</span>
          </SectionTitle>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
            <Card className="flex flex-col justify-between">
              <div>
                <Figure
                  scale="hero"
                  label={`${scopeLabel} net worth`}
                  value={formatMoneyWhole(headline.netWorth)}
                />
                <p className="mt-2 text-xs text-muted">
                  {formatMoney(headline.assets)} in assets less {formatMoney(headline.liabilities)} in
                  liabilities.
                </p>
              </div>

              <dl className="mt-5 space-y-0 border-t border-line pt-3">
                <KeyValue label="Personal net worth" value={formatMoneyWhole(position.personal.netWorth)} />
                <KeyValue label="Business net worth" value={formatMoneyWhole(position.business.netWorth)} />
                <div className="mt-1 border-t border-line pt-1">
                  <KeyValue
                    label={<span className="font-medium text-secondary">Combined</span>}
                    value={formatMoneyWhole(position.combined.netWorth)}
                  />
                </div>
              </dl>
            </Card>

            <Card className="min-w-0">
              <CardHeader
                title="Net worth over the last 12 months"
                subtitle="Assets less liabilities, from daily balance snapshots"
              />
              <NetWorthTrend data={trend} />
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="cash-heading">
          <SectionTitle>
            <span id="cash-heading">Cash position</span>
          </SectionTitle>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <Figure label="Personal cash" value={formatMoney(cash.personal.total)} />
              <p className="mt-1.5 text-xs text-muted">
                {formatMoney(cash.personal.available)} available
              </p>
            </Card>
            <Card>
              <Figure label="Business cash" value={formatMoney(cash.business.total)} />
              <p className="mt-1.5 text-xs text-muted">
                {formatMoney(cash.business.available)} available
              </p>
            </Card>
            <Card>
              <Figure
                label="Cash flow this month"
                value={formatMoney(monthFlow.current.net)}
                tone={monthFlow.current.net.isNegative() ? 'negative' : 'positive'}
                delta={<Delta value={monthFlow.netChange} suffix="vs last month" />}
              />
            </Card>
            <Card>
              <Figure
                label="Cash flow year to date"
                value={formatMoney(ytdFlow.current.net)}
                tone={ytdFlow.current.net.isNegative() ? 'negative' : 'positive'}
              />
              <p className="mt-1.5 text-xs text-muted">
                {formatMoney(ytdFlow.current.inflow)} in · {formatMoney(ytdFlow.current.outflow)} out
              </p>
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.15fr)]">
          <Card className="min-w-0">
            <CardHeader
              title="Income and expenses"
              subtitle={`${formatMoney(periodIncomeExpense.income)} in · ${formatMoney(
                periodIncomeExpense.expenses,
              )} out · ${formatMoney(periodIncomeExpense.net)} net`}
            />
            <CashFlowChart data={series.length > 1 ? series : twelveMonthSeries} />
          </Card>

          <Card>
            <CardHeader
              title="Insights"
              action={
                <Link href="/reports" className="text-xs text-accent hover:underline">
                  All reports
                </Link>
              }
            />
            <InsightList insights={insights} limit={4} />
          </Card>
        </div>

        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="debt-heading">
          <SectionTitle>
            <span id="debt-heading">Debt</span>
          </SectionTitle>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
            <Card>
              <Figure label="Total debt" value={formatMoneyWhole(debt.totalDebt)} />
              <dl className="mt-4 space-y-0 border-t border-line pt-2">
                <KeyValue
                  label="Monthly debt payments"
                  value={formatMoney(debt.totalMinimumPayments)}
                />
                <KeyValue
                  label="Weighted average APR"
                  value={formatPercent(debt.weightedAverageApr, 2)}
                />
                <KeyValue
                  label="Credit utilization"
                  value={formatPercent(debt.creditUtilization, 1)}
                />
                <KeyValue
                  label="Debt-to-income"
                  value={dti !== null ? formatPercent(dti, 1) : 'Needs income data'}
                />
              </dl>
              {debt.creditUtilization !== null ? (
                <div className="mt-3">
                  <Meter
                    value={debt.creditUtilization}
                    tone={
                      debt.creditUtilization >= 0.7
                        ? 'critical'
                        : debt.creditUtilization >= 0.3
                          ? 'warning'
                          : 'good'
                    }
                    label={formatPercent(debt.creditUtilization, 0)}
                  />
                </div>
              ) : null}
            </Card>

            <Card>
              <CardHeader
                title="Debt accounts"
                action={
                  <Link href="/debt" className="text-xs text-accent hover:underline">
                    Debt dashboard
                  </Link>
                }
              />
              <DebtTable accounts={debt.accounts} now={now} />
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="bills-heading">
          <SectionTitle>
            <span id="bills-heading">Upcoming payments</span>
          </SectionTitle>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader
                title="Due in 3 days"
                subtitle={`${upcoming.dueInThreeDays.length} bills · ${formatMoney(
                  sumBy(upcoming.dueInThreeDays, (o) => o.amountDue),
                )}`}
              />
              <UpcomingList
                occurrences={upcoming.dueInThreeDays}
                now={now}
                emptyMessage="Nothing due in the next 3 days."
              />
            </Card>

            <Card>
              <CardHeader
                title="Due this week"
                subtitle={`${upcoming.dueThisWeek.length} bills · ${formatMoney(
                  sumBy(upcoming.dueThisWeek, (o) => o.amountDue),
                )}`}
              />
              <UpcomingList
                occurrences={upcoming.dueThisWeek.slice(0, 6)}
                now={now}
                emptyMessage="Nothing due in the next 7 days."
              />
            </Card>

            <Card>
              <CardHeader
                title="Due within 30 days"
                subtitle={`${upcoming.dueThisMonth.length} bills · ${formatMoney(
                  sumBy(upcoming.dueThisMonth, (o) => o.amountDue),
                )}`}
                action={
                  <Link href="/bills" className="text-xs text-accent hover:underline">
                    Bill pay
                  </Link>
                }
              />
              <UpcomingList
                occurrences={upcoming.dueThisMonth.slice(0, 6)}
                now={now}
                emptyMessage="Nothing due in the next 30 days."
              />
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              title="Where the money went"
              subtitle={`Top categories · ${describeRange(filters.range)}`}
              action={
                <Link href="/transactions" className="text-xs text-accent hover:underline">
                  Transactions
                </Link>
              }
            />
            <CategoryBars
              rows={spendingByCategory(context.transactions).map((row) => ({
                categoryId: row.categoryId,
                categoryName: row.categoryName,
                total: row.total.toFixed(2),
                transactionCount: row.transactionCount,
                shareOfTotal: row.shareOfTotal,
              }))}
            />
          </Card>

          <Card>
            <CardHeader
              title="Recurring expenses"
              subtitle={`${confirmedSeries.length} confirmed series`}
              action={
                <Link href="/bills/recurring" className="text-xs text-accent hover:underline">
                  Review
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-4">
              <Figure scale="md" label="Monthly" value={formatMoney(recurring.monthly)} />
              <Figure scale="md" label="Annual" value={formatMoney(recurring.annual)} />
            </div>
            <dl className="mt-4 space-y-0 border-t border-line pt-2">
              <KeyValue label="Personal bills / month" value={formatMoney(billTotals.personalMonthly)} />
              <KeyValue label="Business bills / month" value={formatMoney(billTotals.businessMonthly)} />
            </dl>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- */}
        {performances.length > 0 ? (
          <section aria-labelledby="business-heading">
            <SectionTitle
              action={
                <Link href="/business" className="text-xs text-accent hover:underline">
                  Business dashboard
                </Link>
              }
            >
              <span id="business-heading">Business performance</span>
            </SectionTitle>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {performances.map((performance) => {
                const entity = businessEntities.find((candidate) => candidate.id === performance.pnl.entityId)

                return (
                  <Card key={performance.pnl.entityId}>
                    <div className="mb-3 flex items-center gap-2">
                      <Dot color={entity?.color ?? 'var(--color-muted)'} />
                      <p className="truncate text-sm font-semibold text-primary">
                        {performance.pnl.entityName}
                      </p>
                    </div>

                    <Figure
                      scale="lg"
                      label="Net operating income"
                      value={formatMoney(performance.pnl.netOperatingIncome)}
                      tone={performance.pnl.netOperatingIncome.isNegative() ? 'negative' : 'positive'}
                      delta={<Delta value={performance.revenueChange} suffix="revenue" />}
                    />

                    <dl className="mt-4 space-y-0 border-t border-line pt-2">
                      <KeyValue label="Revenue" value={formatMoney(performance.pnl.revenue)} />
                      <KeyValue label="Expenses" value={formatMoney(performance.pnl.operatingExpenses)} />
                      <KeyValue
                        label="Profit margin"
                        value={formatPercent(performance.pnl.profitMargin, 1)}
                      />
                      <KeyValue label="Cash balance" value={formatMoney(performance.cashBalance)} />
                      <KeyValue label="Monthly burn" value={formatMoney(performance.monthlyBurn)} />
                    </dl>
                  </Card>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {portfolio.propertyCount > 0 ? (
          <section aria-labelledby="property-heading">
            <SectionTitle
              action={
                <Link href="/real-estate" className="text-xs text-accent hover:underline">
                  Real estate
                </Link>
              }
            >
              <span id="property-heading">Real estate</span>
            </SectionTitle>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <Figure label="Portfolio value" value={formatMoneyWhole(portfolio.totalValue)} />
                <p className="mt-1.5 text-xs text-muted">
                  {portfolio.propertyCount} properties · {portfolio.rentalCount} rentals
                </p>
              </Card>
              <Card>
                <Figure label="Total equity" value={formatMoneyWhole(portfolio.totalEquity)} />
                <p className="mt-1.5 text-xs text-muted">
                  {formatMoneyWhole(portfolio.totalMortgageBalance)} in mortgages
                </p>
              </Card>
              <Card>
                <Figure
                  label="Monthly rent"
                  value={formatMoney(portfolio.monthlyRent)}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {formatMoney(portfolio.monthlyDebtService)} debt service
                </p>
              </Card>
              <Card>
                <Figure
                  label="Monthly cash flow"
                  value={formatMoney(portfolio.monthlyCashFlow)}
                  tone={portfolio.monthlyCashFlow.isNegative() ? 'negative' : 'positive'}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {formatMoney(portfolio.annualCashFlow)} annually
                </p>
              </Card>
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}

function isLiability(type: string): boolean {
  return [
    'CREDIT_CARD',
    'LINE_OF_CREDIT',
    'AUTO_LOAN',
    'MORTGAGE',
    'STUDENT_LOAN',
    'PERSONAL_LOAN',
    'BUSINESS_LOAN',
    'OTHER_LIABILITY',
  ].includes(type)
}
