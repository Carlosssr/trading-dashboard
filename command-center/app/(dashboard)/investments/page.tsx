import { prisma } from '@/lib/db'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters, ledgerFilter } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { isInvestment } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatSigned, money, ratio, sumBy } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card, CardHeader, EmptyState, Figure, Meter, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)
  const ledger = ledgerFilter(filters.ledger)

  const [context, holdings] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    prisma.holding.findMany({
      where: {
        workspaceId: scope.workspaceId,
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        ...(ledger ? { account: { ledger } } : {}),
      },
      include: { account: { select: { id: true, name: true, institutionName: true, type: true } } },
      orderBy: { value: 'desc' },
    }),
  ])

  const accounts = context.accounts.filter(
    (account) => isInvestment(account.type) && !account.isClosed,
  )
  const totalValue = sumBy(accounts, (account) => account.currentBalance)
  const totalCostBasis = sumBy(holdings, (holding) => holding.costBasis ?? 0)
  const totalHoldingValue = sumBy(holdings, (holding) => holding.value)
  const unrealized = totalCostBasis.greaterThan(0) ? totalHoldingValue.minus(totalCostBasis) : null

  const byAccount = accounts.map((account) => ({
    account,
    holdings: holdings.filter((holding) => holding.account.id === account.id),
  }))

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Investments"
        description={`${accounts.length} accounts · ${holdings.length} positions`}
      />

      <div className="space-y-6 px-6 py-6">
        {accounts.length === 0 ? (
          <EmptyState
            title="No investment accounts"
            description="Investment and retirement accounts appear here once an institution reporting them is linked."
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <Figure label="Total value" value={formatMoneyWhole(totalValue)} />
              </Card>
              <Card>
                <Figure
                  label="Cost basis"
                  value={totalCostBasis.greaterThan(0) ? formatMoneyWhole(totalCostBasis) : '—'}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {totalCostBasis.greaterThan(0)
                    ? 'Across positions reporting a basis'
                    : 'Not reported by these institutions'}
                </p>
              </Card>
              <Card>
                <Figure
                  label="Unrealized gain"
                  value={unrealized ? formatSigned(unrealized) : '—'}
                  tone={unrealized?.isNegative() ? 'negative' : 'positive'}
                />
                {unrealized ? (
                  <p className="mt-1.5 text-xs text-muted">
                    {((unrealized.dividedBy(totalCostBasis).toNumber() || 0) * 100).toFixed(1)}% above
                    basis
                  </p>
                ) : null}
              </Card>
            </div>

            {byAccount.map(({ account, holdings: accountHoldings }) => (
              <section key={account.id}>
                <SectionTitle>
                  {account.name} · {formatMoney(account.currentBalance)}
                </SectionTitle>

                <Card>
                  <CardHeader
                    title={account.institutionName}
                    subtitle={`${accountHoldings.length} positions · ${
                      account.ledger === 'BUSINESS' ? 'business' : 'personal'
                    } ledger`}
                  />

                  {accountHoldings.length === 0 ? (
                    <p className="py-4 text-xs text-muted">
                      This institution reports a balance but not individual positions.
                    </p>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Security</Th>
                          <Th>Ticker</Th>
                          <Th align="right">Quantity</Th>
                          <Th align="right">Price</Th>
                          <Th align="right">Value</Th>
                          <Th align="right">Cost basis</Th>
                          <Th align="right">Gain</Th>
                          <Th>Share of account</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountHoldings.map((holding) => {
                          const gain = holding.costBasis
                            ? money(holding.value).minus(money(holding.costBasis))
                            : null

                          return (
                            <tr key={holding.id}>
                              <Td>
                                <span className="font-medium text-primary">{holding.securityName}</span>
                              </Td>
                              <Td>
                                <span className="text-xs">{holding.ticker ?? '—'}</span>
                              </Td>
                              <Td align="right" numeric>
                                {holding.quantity.toFixed(2)}
                              </Td>
                              <Td align="right" numeric>
                                {formatMoney(holding.price)}
                              </Td>
                              <Td align="right" numeric className="font-medium">
                                {formatMoney(holding.value)}
                              </Td>
                              <Td align="right" numeric>
                                {holding.costBasis ? formatMoney(holding.costBasis) : '—'}
                              </Td>
                              <Td
                                align="right"
                                numeric
                                className={
                                  gain?.isNegative()
                                    ? 'text-[var(--delta-down)]'
                                    : gain
                                      ? 'text-[var(--delta-up)]'
                                      : ''
                                }
                              >
                                {gain ? formatSigned(gain) : '—'}
                              </Td>
                              <Td>
                                <Meter value={ratio(holding.value, account.currentBalance)} />
                              </Td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </Table>
                  )}
                </Card>
              </section>
            ))}

            <Card>
              <p className="text-[11px] leading-relaxed text-muted">
                Positions are shown as reported at the last sync. This view deliberately stops at holdings
                and unrealized gain — performance attribution, cost-basis lots, and tax reporting are out of
                scope for this version rather than approximated.
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
