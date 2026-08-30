import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import {
  summarizeDebt,
  debtToIncome,
  monthsToPayoff,
  totalInterestThisMonth,
} from '@/lib/finance/debt'
import { estimateMonthlyIncome, withinRange } from '@/lib/finance/cash-flow'
import { accountTypeLabel, isRevolving } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatPercent, money } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card, CardHeader, EmptyState, Figure, KeyValue, Meter, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { DebtTable } from '@/components/finance/debt-table'

export const dynamic = 'force-dynamic'

export default async function DebtPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const context = await loadFinancialContext(scope, filters, now)
  const debt = summarizeDebt(context.accounts)

  const monthlyIncome = estimateMonthlyIncome(
    withinRange(context.trendTransactions, {
      start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
      end: now,
    }),
    6,
  )
  const dti = monthlyIncome ? debtToIncome(debt.totalMinimumPayments, monthlyIncome) : null
  const monthlyInterest = totalInterestThisMonth(debt.accounts)

  const personalDebt = summarizeDebt(context.accounts.filter((a) => a.ledger === 'PERSONAL'))
  const businessDebt = summarizeDebt(context.accounts.filter((a) => a.ledger === 'BUSINESS'))

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Debt"
        description="Every liability, its cost, and what it takes to clear it"
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Figure label="Total debt" value={formatMoneyWhole(debt.totalDebt)} />
            <p className="mt-1.5 text-xs text-muted">
              {formatMoney(personalDebt.totalDebt)} personal · {formatMoney(businessDebt.totalDebt)} business
            </p>
          </Card>
          <Card>
            <Figure label="Monthly debt payments" value={formatMoney(debt.totalMinimumPayments)} />
            <p className="mt-1.5 text-xs text-muted">
              {formatMoney(monthlyInterest)} of that is interest
            </p>
          </Card>
          <Card>
            <Figure label="Weighted average APR" value={formatPercent(debt.weightedAverageApr, 2)} />
            <p className="mt-1.5 text-xs text-muted">Weighted by balance, not averaged flat</p>
          </Card>
          <Card>
            <Figure
              label="Debt-to-income"
              value={dti !== null ? formatPercent(dti, 1) : '—'}
            />
            <p className="mt-1.5 text-xs text-muted">
              {monthlyIncome
                ? `Against ${formatMoney(monthlyIncome)} estimated monthly income`
                : 'Needs income data'}
            </p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
          <Card>
            <CardHeader title="Credit utilization" subtitle="Revolving accounts with a known limit" />
            {debt.creditUtilization === null ? (
              <p className="py-4 text-xs text-muted">No revolving accounts with a reported limit.</p>
            ) : (
              <>
                <Figure scale="lg" value={formatPercent(debt.creditUtilization, 1)} />
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
                  />
                </div>
                <dl className="mt-4 space-y-0 border-t border-line pt-2">
                  <KeyValue label="Revolving balance" value={formatMoney(debt.revolvingBalance)} />
                  <KeyValue label="Total limit" value={formatMoney(debt.revolvingLimit)} />
                  <KeyValue
                    label="Available credit"
                    value={formatMoney(debt.revolvingLimit.minus(debt.revolvingBalance))}
                  />
                </dl>
              </>
            )}
          </Card>

          <Card>
            <CardHeader title="All debt" subtitle={`${debt.accounts.length} accounts`} />
            <DebtTable accounts={debt.accounts} now={now} />
          </Card>
        </div>

        <section>
          <SectionTitle>Payoff outlook</SectionTitle>
          <Card>
            {debt.accounts.length === 0 ? (
              <EmptyState title="No debt to project." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th align="right">Balance</Th>
                    <Th align="right">APR</Th>
                    <Th align="right">Payment</Th>
                    <Th align="right">Interest / month</Th>
                    <Th align="right">Months at current payment</Th>
                    <Th>Type</Th>
                  </tr>
                </thead>
                <tbody>
                  {debt.accounts.map((account) => {
                    const months = monthsToPayoff(
                      account.currentBalance,
                      account.apr ?? null,
                      account.minimumPayment ?? 0,
                    )
                    const interest =
                      typeof account.apr === 'number'
                        ? money(account.currentBalance).abs().times(account.apr / 12)
                        : null

                    return (
                      <tr key={account.id}>
                        <Td>
                          <span className="font-medium text-primary">{account.name}</span>
                          <span className="block text-xs text-muted">{account.institutionName}</span>
                        </Td>
                        <Td align="right" numeric>
                          {formatMoney(account.currentBalance)}
                        </Td>
                        <Td align="right" numeric>
                          {account.apr ? formatPercent(account.apr, 2) : '—'}
                        </Td>
                        <Td align="right" numeric>
                          {account.minimumPayment ? formatMoney(account.minimumPayment) : '—'}
                        </Td>
                        <Td align="right" numeric>
                          {interest ? formatMoney(interest) : '—'}
                        </Td>
                        <Td align="right" numeric>
                          {months === null ? (
                            // Either no payment is recorded, or the payment does
                            // not cover the interest — both deserve saying so
                            // rather than a made-up number.
                            <span className="text-xs text-muted">
                              {account.minimumPayment ? 'Payment does not cover interest' : 'No payment set'}
                            </span>
                          ) : months === 0 ? (
                            'Paid'
                          ) : (
                            `${months} (${(months / 12).toFixed(1)} yrs)`
                          )}
                        </Td>
                        <Td>
                          <span className="text-xs">{accountTypeLabel(account.type)}</span>
                          {isRevolving(account.type) ? (
                            <span className="block text-[11px] text-muted">Revolving</span>
                          ) : null}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              Months to payoff assumes the current payment continues unchanged and no further charges are
              made. It is arithmetic on the balance, rate, and payment shown — not a recommendation.
            </p>
          </Card>
        </section>
      </div>
    </>
  )
}
