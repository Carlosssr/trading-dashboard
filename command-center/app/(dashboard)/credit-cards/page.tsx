import { format, differenceInCalendarDays } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { describeCard, summarizeDebt, CARD_THRESHOLDS, type CardFlag } from '@/lib/finance/debt'
import { isRevolving } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatPercent } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, EmptyState, Figure, KeyValue, Meter, SectionTitle } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

const FLAG_LABELS: Record<CardFlag, { label: string; tone: 'warning' | 'critical' | 'serious' }> = {
  'high-utilization': { label: 'High utilization', tone: 'warning' },
  'over-limit': { label: 'Over limit', tone: 'critical' },
  'high-apr': { label: 'High APR', tone: 'serious' },
  'due-soon': { label: 'Due soon', tone: 'serious' },
}

export default async function CreditCardsPage({
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

  const cards = context.accounts
    .filter((account) => isRevolving(account.type) && !account.isClosed)
    .map((account) => describeCard(account, now))
    // Most-utilized first: the cards that need looking at come to the top.
    .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))

  const flagged = cards.filter((card) => card.flags.length > 0)

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Credit Cards"
        description={`${cards.length} cards · ${formatPercent(debt.creditUtilization, 1)} overall utilization`}
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Figure label="Total card balance" value={formatMoneyWhole(debt.revolvingBalance)} />
          </Card>
          <Card>
            <Figure label="Total credit limit" value={formatMoneyWhole(debt.revolvingLimit)} />
          </Card>
          <Card>
            <Figure
              label="Available credit"
              value={formatMoneyWhole(debt.revolvingLimit.minus(debt.revolvingBalance))}
            />
          </Card>
          <Card>
            <Figure label="Overall utilization" value={formatPercent(debt.creditUtilization, 1)} />
            {debt.creditUtilization !== null ? (
              <div className="mt-3">
                <Meter
                  value={debt.creditUtilization}
                  tone={
                    debt.creditUtilization >= CARD_THRESHOLDS.criticalUtilization
                      ? 'critical'
                      : debt.creditUtilization >= CARD_THRESHOLDS.highUtilization
                        ? 'warning'
                        : 'good'
                  }
                />
              </div>
            ) : null}
          </Card>
        </div>

        {flagged.length > 0 ? (
          <Card>
            <CardHeader
              title="Cards worth a look"
              subtitle={`Flagged above ${formatPercent(CARD_THRESHOLDS.highUtilization, 0)} utilization, ${formatPercent(
                CARD_THRESHOLDS.highApr,
                0,
              )} APR, or due within ${CARD_THRESHOLDS.dueSoonDays} days`}
            />
            <ul className="space-y-2">
              {flagged.map((card) => (
                <li key={card.account.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-primary">{card.account.name}</span>
                  {card.flags.map((flag) => (
                    <Badge key={flag} tone={FLAG_LABELS[flag].tone}>
                      {FLAG_LABELS[flag].label}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <section>
          <SectionTitle>All cards</SectionTitle>

          {cards.length === 0 ? (
            <EmptyState
              title="No credit cards connected"
              description="Cards appear here once an institution reporting them is linked."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => {
                const daysToDue = card.account.nextPaymentDueAt
                  ? differenceInCalendarDays(card.account.nextPaymentDueAt, now)
                  : null

                return (
                  <Card key={card.account.id}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-primary">{card.account.name}</p>
                        <p className="truncate text-xs text-muted">
                          {card.account.institutionName}
                          {card.account.mask ? ` ····${card.account.mask}` : ''}
                        </p>
                      </div>
                      <Badge tone={card.account.ledger === 'BUSINESS' ? 'accent' : 'neutral'}>
                        {card.account.ledger === 'BUSINESS' ? 'Business' : 'Personal'}
                      </Badge>
                    </div>

                    <Figure scale="lg" label="Balance" value={formatMoney(card.balance)} />

                    {card.utilization !== null ? (
                      <div className="mt-3">
                        <Meter
                          value={card.utilization}
                          label={formatPercent(card.utilization, 0)}
                          tone={
                            card.utilization >= CARD_THRESHOLDS.criticalUtilization
                              ? 'critical'
                              : card.utilization >= CARD_THRESHOLDS.highUtilization
                                ? 'warning'
                                : 'good'
                          }
                        />
                      </div>
                    ) : null}

                    <dl className="mt-3 space-y-0 border-t border-line pt-2">
                      <KeyValue
                        label="Credit limit"
                        value={card.creditLimit ? formatMoney(card.creditLimit) : 'Not reported'}
                      />
                      <KeyValue
                        label="Available credit"
                        value={card.availableCredit ? formatMoney(card.availableCredit) : '—'}
                      />
                      <KeyValue
                        label="Statement balance"
                        value={card.statementBalance ? formatMoney(card.statementBalance) : '—'}
                      />
                      <KeyValue
                        label="Minimum payment"
                        value={
                          card.account.minimumPayment ? formatMoney(card.account.minimumPayment) : '—'
                        }
                      />
                      <KeyValue label="APR" value={card.account.apr ? formatPercent(card.account.apr, 2) : '—'} />
                      <KeyValue
                        label="Payment due"
                        value={
                          card.account.nextPaymentDueAt
                            ? `${format(card.account.nextPaymentDueAt, 'MMM d')}${
                                daysToDue !== null && daysToDue >= 0 ? ` · in ${daysToDue}d` : ''
                              }`
                            : '—'
                        }
                      />
                    </dl>

                    {card.flags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                        {card.flags.map((flag) => (
                          <Badge key={flag} tone={FLAG_LABELS[flag].tone}>
                            {FLAG_LABELS[flag].label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
