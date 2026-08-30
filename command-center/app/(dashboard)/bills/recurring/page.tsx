import Link from 'next/link'
import { format } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listRecurring } from '@/lib/services/recurring'
import { CADENCE_LABELS, monthlyEquivalent, totalRecurring, DETECTION } from '@/lib/finance/recurrence'
import { isCash } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatPercent } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, Dot, EmptyState, Figure, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { DetectionActions } from '@/components/bills/detection-actions'

export const dynamic = 'force-dynamic'

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const [context, series] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    listRecurring(scope),
  ])

  const detected = series.filter((item) => item.status === 'DETECTED')
  const confirmed = series.filter((item) => item.status === 'CONFIRMED')
  const ignored = series.filter((item) => item.status === 'IGNORED')

  const totals = totalRecurring(confirmed)

  const byCategory = new Map<string, { total: number; count: number }>()
  for (const item of confirmed) {
    const key = item.category?.name ?? 'Uncategorized'
    const monthly = monthlyEquivalent(item.averageAmount, item.cadence).toNumber()
    const existing = byCategory.get(key)
    if (existing) {
      existing.total += monthly
      existing.count += 1
    } else {
      byCategory.set(key, { total: monthly, count: 1 })
    }
  }
  const categoryRows = [...byCategory.entries()].sort((a, b) => b[1].total - a[1].total)

  const fundingAccounts = context.accounts
    .filter((account) => isCash(account.type) && !account.isClosed)
    .map((account) => ({
      id: account.id,
      label: `${account.name}${account.mask ? ` ····${account.mask}` : ''}`,
    }))

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Recurring Expenses"
        description="Detected automatically from transaction history"
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Figure label="Monthly recurring" value={formatMoneyWhole(totals.monthly)} />
            <p className="mt-1.5 text-xs text-muted">{confirmed.length} confirmed series</p>
          </Card>
          <Card>
            <Figure label="Annual recurring" value={formatMoneyWhole(totals.annual)} />
            <p className="mt-1.5 text-xs text-muted">Every cadence normalized to a yearly figure</p>
          </Card>
          <Card>
            <Figure label="Awaiting review" value={String(detected.length)} />
            <p className="mt-1.5 text-xs text-muted">
              Proposals shown at {formatPercent(DETECTION.minConfidence, 0)} confidence or higher
            </p>
          </Card>
        </div>

        <section>
          <SectionTitle>Detected payments</SectionTitle>
          <Card>
            {detected.length === 0 ? (
              <EmptyState
                title="No new recurring payments detected"
                description="New proposals appear here after a sync finds a repeating pattern with at least three occurrences."
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {detected.map((item) => (
                  <li key={item.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        {/* The proposal sentence the brief specifies. */}
                        <p className="text-sm text-primary">
                          We detected a recurring{' '}
                          <span className="font-semibold">{formatMoney(item.averageAmount)}</span> payment
                          to <span className="font-semibold">{item.merchantName}</span>{' '}
                          {CADENCE_LABELS[item.cadence].toLowerCase()}. Add this as a bill?
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>
                            {item.occurrenceCount} occurrences · {formatPercent(item.confidence, 0)}{' '}
                            confidence
                          </span>
                          {item.account ? <span>· {item.account.name}</span> : null}
                          {item.nextExpectedAt ? (
                            <span>· next expected {format(item.nextExpectedAt, 'MMM d')}</span>
                          ) : null}
                          {item.minAmount.equals(item.maxAmount) ? null : (
                            <span>
                              · ranges {formatMoney(item.minAmount)}–{formatMoney(item.maxAmount)}
                            </span>
                          )}
                        </p>
                      </div>

                      <DetectionActions
                        seriesId={item.id}
                        merchantName={item.merchantName}
                        amount={item.averageAmount.toFixed(2)}
                        cadence={item.cadence}
                        fundingAccounts={fundingAccounts}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              title="Confirmed recurring expenses"
              subtitle={`${confirmed.length} series · ${formatMoney(totals.monthly)} a month`}
              action={
                <Link href="/bills" className="text-xs text-accent hover:underline">
                  Bill pay
                </Link>
              }
            />
            {confirmed.length === 0 ? (
              <EmptyState title="Nothing confirmed yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Merchant</Th>
                    <Th>Category</Th>
                    <Th>Cadence</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Per month</Th>
                    <Th>Entity</Th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed.map((item) => (
                    <tr key={item.id}>
                      <Td>
                        <span className="font-medium text-primary">{item.merchantName}</span>
                        {item._count.bills > 0 ? (
                          <Badge tone="good" className="ml-2">
                            Bill
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="text-xs">{item.category?.name ?? 'Uncategorized'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs">{CADENCE_LABELS[item.cadence]}</span>
                      </Td>
                      <Td align="right" numeric>
                        {formatMoney(item.averageAmount)}
                      </Td>
                      <Td align="right" numeric className="font-medium">
                        {formatMoney(monthlyEquivalent(item.averageAmount, item.cadence))}
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5 text-xs">
                          <Dot color={item.entity.ledger === 'BUSINESS' ? '#1d4ed8' : '#0f766e'} />
                          {item.entity.name}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="By category" subtitle="Monthly equivalent" />
            {categoryRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">Nothing confirmed yet.</p>
            ) : (
              <ul className="space-y-2">
                {categoryRows.map(([name, value]) => (
                  <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-secondary">
                      {name}
                      <span className="ml-1.5 text-xs text-muted">({value.count})</span>
                    </span>
                    <span className="tabular shrink-0 font-medium text-primary">
                      {formatMoney(value.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {ignored.length > 0 ? (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                {ignored.length} series ignored. Ignored series stay ignored across syncs and are not
                re-proposed.
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  )
}
