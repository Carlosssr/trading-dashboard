import { format } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters, ledgerFilter } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listProperties, toCalculationInput } from '@/lib/services/properties'
import { computePortfolio, computePropertyMetrics } from '@/lib/finance/real-estate'
import { formatMoney, formatMoneyWhole, formatPercent } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, Dot, EmptyState, Figure, KeyValue, Meter, SectionTitle } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function RealEstatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)
  const ledger = ledgerFilter(filters.ledger)

  const [context, properties] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    listProperties(scope, {
      ...(ledger ? { ledger } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
    }),
  ])

  const inputs = properties.map(toCalculationInput)
  const portfolio = computePortfolio(inputs)

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Real Estate"
        description={`${portfolio.propertyCount} properties · ${portfolio.rentalCount} rentals`}
      />

      <div className="space-y-6 px-6 py-6">
        {properties.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Add a property to track its value, mortgage, equity, and rental cash flow."
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <Figure label="Portfolio value" value={formatMoneyWhole(portfolio.totalValue)} />
                <p className="mt-1.5 text-xs text-muted">Manual valuations</p>
              </Card>
              <Card>
                <Figure label="Mortgage balance" value={formatMoneyWhole(portfolio.totalMortgageBalance)} />
                <p className="mt-1.5 text-xs text-muted">
                  {formatMoney(portfolio.monthlyDebtService)} monthly debt service
                </p>
              </Card>
              <Card>
                <Figure label="Total equity" value={formatMoneyWhole(portfolio.totalEquity)} />
                <p className="mt-1.5 text-xs text-muted">Estimated value less mortgage balance</p>
              </Card>
              <Card>
                <Figure
                  label="Monthly cash flow"
                  value={formatMoney(portfolio.monthlyCashFlow)}
                  tone={portfolio.monthlyCashFlow.isNegative() ? 'negative' : 'positive'}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {formatMoney(portfolio.monthlyRent)} rent less expenses and debt service
                </p>
              </Card>
            </div>

            <section>
              <SectionTitle>Properties</SectionTitle>
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {properties.map((property) => {
                  const metrics = computePropertyMetrics(toCalculationInput(property))

                  return (
                    <Card key={property.id}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-primary">{property.name}</p>
                          <p className="truncate text-xs text-muted">
                            {[property.addressLine1, property.city, property.region]
                              .filter(Boolean)
                              .join(', ') || 'No address recorded'}
                          </p>
                        </div>
                        <Badge tone={property.isRental ? 'accent' : 'neutral'}>
                          {property.propertyType.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <Figure
                          scale="md"
                          label="Estimated value"
                          value={formatMoneyWhole(property.estimatedValue)}
                        />
                        <Figure scale="md" label="Equity" value={formatMoneyWhole(metrics.equity)} />
                      </div>

                      <div className="mt-3">
                        <Meter value={metrics.equityPercent} label={formatPercent(metrics.equityPercent, 0)} />
                        <p className="mt-1 text-[11px] text-muted">Share of the property owned outright</p>
                      </div>

                      <dl className="mt-4 space-y-0 border-t border-line pt-2">
                        <KeyValue
                          label="Mortgage balance"
                          value={formatMoney(
                            property.mortgageAccount?.currentBalance ??
                              property.manualMortgageBalance ??
                              0,
                          )}
                        />
                        <KeyValue
                          label="Interest rate"
                          value={
                            metrics.debtService.isZero() && !property.mortgageAccount
                              ? '—'
                              : formatPercent(toCalculationInput(property).mortgageRate, 2)
                          }
                        />
                        <KeyValue label="Monthly payment" value={formatMoney(metrics.debtService)} />
                        <KeyValue
                          label="Property taxes"
                          value={formatMoney(property.monthlyPropertyTax)}
                        />
                        <KeyValue label="Insurance" value={formatMoney(property.monthlyInsurance)} />
                        {property.isRental ? (
                          <>
                            <KeyValue label="Monthly rent" value={formatMoney(property.monthlyRent)} />
                            <KeyValue
                              label="Monthly expenses"
                              value={formatMoney(metrics.monthlyExpenses)}
                            />
                          </>
                        ) : null}
                      </dl>

                      <div className="mt-3 border-t border-line pt-3">
                        {property.isRental ? (
                          <>
                            <Figure
                              scale="md"
                              label="Net monthly cash flow"
                              value={formatMoney(metrics.monthlyCashFlow)}
                              tone={metrics.monthlyCashFlow.isNegative() ? 'negative' : 'positive'}
                            />
                            <p className="mt-1 text-[11px] text-muted">
                              Rent − expenses − debt service · {formatMoney(metrics.annualCashFlow)} a year
                              {metrics.capRate !== null
                                ? ` · ${formatPercent(metrics.capRate, 2)} cap rate`
                                : ''}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-muted">
                            Owner-occupied — carrying cost is {formatMoney(
                              metrics.monthlyExpenses.plus(metrics.debtService),
                            )}{' '}
                            a month.
                          </p>
                        )}
                      </div>

                      {metrics.appreciation ? (
                        <p className="mt-3 text-[11px] text-muted">
                          {metrics.appreciation.isNegative() ? 'Down' : 'Up'}{' '}
                          {formatMoney(metrics.appreciation.abs())} (
                          {formatPercent(Math.abs(metrics.appreciationPercent ?? 0), 1)}) since purchase
                          {property.purchaseDate ? ` in ${format(property.purchaseDate, 'MMMM yyyy')}` : ''}.
                        </p>
                      ) : null}

                      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                        <Dot color={property.entity.color} />
                        <span className="text-xs text-secondary">{property.entity.name}</span>
                        <span className="ml-auto text-[11px] text-muted">
                          Valued {format(property.valuationAsOf, 'MMM d, yyyy')} ·{' '}
                          {property.valuationSource.toLowerCase()}
                        </span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>

            <Card>
              <CardHeader title="How these figures are produced" />
              <ul className="space-y-1.5 text-xs leading-relaxed text-secondary">
                <li>
                  <span className="font-medium text-primary">Equity</span> is estimated value less the
                  mortgage balance, taken from the linked mortgage account when one exists and from the
                  manually entered figure otherwise.
                </li>
                <li>
                  <span className="font-medium text-primary">Monthly cash flow</span> is rental income less
                  property expenses less debt service. Taxes and insurance are held separately from the
                  mortgage payment, so an escrowed payment is not counted twice.
                </li>
                <li>
                  <span className="font-medium text-primary">Valuations are manual.</span> Each change is
                  appended to a valuation history, so an automated valuation source can begin writing to the
                  same place without any change to how this page reads.
                </li>
              </ul>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
