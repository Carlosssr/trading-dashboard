import Link from 'next/link'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters, ledgerFilter } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listOccurrences } from '@/lib/services/bills'
import { listPayments } from '@/lib/services/payments'
import { listCashReserves } from '@/lib/services/entities'
import { summarizeBillPay, billIndicator, INDICATOR_META, type BillOccurrenceInput } from '@/lib/finance/bills'
import { isCash } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, Dot, EmptyState, Figure, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { BillCalendar } from '@/components/bills/bill-calendar'
import { PayBillDialog } from '@/components/bills/pay-bill-dialog'
import { OccurrenceActions } from '@/components/bills/occurrence-actions'

export const dynamic = 'force-dynamic'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const params = await searchParams
  const filters = parseFilters(params, now)

  // The calendar navigates by month independently of the period filter, which
  // controls the money figures rather than the grid.
  const monthOffset = Number(typeof params.month === 'string' ? params.month : '0') || 0
  const calendarMonth = addMonths(now, monthOffset)

  const ledger = ledgerFilter(filters.ledger)
  const filter = {
    ...(ledger ? { ledger } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
  }

  const [context, calendarRows, payments, reserves] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    listOccurrences(
      scope,
      { start: startOfMonth(subMonths(calendarMonth, 1)), end: endOfMonth(addMonths(calendarMonth, 1)) },
      filter,
    ),
    listPayments(scope, filter),
    listCashReserves(scope),
  ])

  const calendarOccurrences: BillOccurrenceInput[] = calendarRows.map((occurrence) => ({
    id: occurrence.id,
    billId: occurrence.billId,
    billName: occurrence.bill.name,
    payeeName: occurrence.bill.payeeName,
    dueAt: occurrence.dueAt,
    amountDue: occurrence.amountDue,
    status: occurrence.status,
    autopay: occurrence.bill.autopay,
    ledger: occurrence.bill.ledger,
    entityId: occurrence.bill.entityId,
    entityName: occurrence.bill.entity.name,
    categoryName: occurrence.bill.category?.name ?? null,
    fundingAccountName: occurrence.bill.fundingAccount?.name ?? null,
    fundingAccountMask: occurrence.bill.fundingAccount?.mask ?? null,
    paidAt: occurrence.paidAt,
    paidAmount: occurrence.paidAmount,
  }))

  const summary = summarizeBillPay(context.occurrences, now)

  const fundingAccounts = context.accounts
    .filter((account) => isCash(account.type) && !account.isClosed)
    .map((account) => ({
      id: account.id,
      label: `${account.institutionName} ${account.name}${account.mask ? ` ····${account.mask}` : ''}`,
      availableBalance: account.availableBalance ? formatMoney(account.availableBalance) : null,
    }))

  // The month's occurrences, most urgent first.
  const monthRows = calendarRows
    .filter(
      (occurrence) =>
        occurrence.dueAt >= startOfMonth(calendarMonth) && occurrence.dueAt <= endOfMonth(calendarMonth),
    )
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Bill Pay"
        description="Track what is due, and pay it with an explicit confirmation"
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Figure label="Due this month" value={formatMoneyWhole(summary.amountDueThisMonth)} />
            <p className="mt-1.5 text-xs text-muted">
              {summary.billsDueThisMonth} bills · {summary.autopayCount} on autopay ·{' '}
              {summary.manualCount} manual
            </p>
          </Card>
          <Card>
            <Figure label="Due in 7 days" value={formatMoneyWhole(summary.dueNextSevenDays)} />
            <p className="mt-1.5 text-xs text-muted">
              {formatMoney(summary.dueNextThirtyDays)} due within 30 days
            </p>
          </Card>
          <Card>
            <Figure label="Paid this month" value={formatMoneyWhole(summary.paidThisMonth)} tone="positive" />
            <p className="mt-1.5 text-xs text-muted">{summary.paidCount} bills settled</p>
          </Card>
          <Card>
            <Figure
              label="Still outstanding"
              value={formatMoneyWhole(summary.outstanding)}
              tone={summary.overdueCount > 0 ? 'negative' : 'default'}
            />
            <p className="mt-1.5 text-xs text-muted">
              {summary.overdueCount > 0
                ? `${summary.overdueCount} overdue · ${formatMoney(summary.overdueAmount)}`
                : 'Nothing overdue'}
            </p>
          </Card>
        </div>

        <Card>
          <CardHeader
            title={format(calendarMonth, 'MMMM yyyy')}
            subtitle="Every scheduled payment, by due date"
            action={
              <div className="flex items-center gap-1.5">
                <MonthLink offset={monthOffset - 1} label="Previous" params={params} />
                {monthOffset !== 0 ? <MonthLink offset={0} label="Today" params={params} /> : null}
                <MonthLink offset={monthOffset + 1} label="Next" params={params} />
                <Link href="/bills/recurring" className="ml-2 text-xs text-accent hover:underline">
                  Recurring
                </Link>
              </div>
            }
          />
          <BillCalendar occurrences={calendarOccurrences} month={calendarMonth} today={now} />
        </Card>

        <section>
          <SectionTitle>{format(calendarMonth, 'MMMM')} bills</SectionTitle>
          <Card>
            {monthRows.length === 0 ? (
              <EmptyState
                title="No bills this month"
                description="Detected recurring payments can be turned into bills from the Recurring page."
                action={
                  <Link href="/bills/recurring" className="text-xs text-accent hover:underline">
                    Review detected payments
                  </Link>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Bill</Th>
                    <Th>Due</Th>
                    <Th align="right">Amount</Th>
                    <Th>Pay from</Th>
                    <Th>Entity</Th>
                    <Th>Status</Th>
                    <Th align="right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {monthRows.map((occurrence) => {
                    const shaped = calendarOccurrences.find((item) => item.id === occurrence.id)!
                    const indicator = billIndicator(shaped, now)

                    return (
                      <tr key={occurrence.id}>
                        <Td>
                          <span className="font-medium text-primary">{occurrence.bill.name}</span>
                          <span className="block text-xs text-muted">
                            {occurrence.bill.category?.name ?? 'Uncategorized'}
                            {occurrence.bill.autopay ? ' · autopay' : ''}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="tabular text-xs">{format(occurrence.dueAt, 'MMM d')}</span>
                        </Td>
                        <Td align="right" numeric className="font-medium">
                          {formatMoney(occurrence.amountDue)}
                        </Td>
                        <Td>
                          <span className="text-xs">
                            {occurrence.bill.fundingAccount
                              ? `${occurrence.bill.fundingAccount.name}${
                                  occurrence.bill.fundingAccount.mask
                                    ? ` ····${occurrence.bill.fundingAccount.mask}`
                                    : ''
                                }`
                              : 'Not set'}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-1.5 text-xs">
                            <Dot color={occurrence.bill.entity.color} />
                            {occurrence.bill.entity.name}
                          </span>
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              indicator === 'overdue'
                                ? 'critical'
                                : indicator === 'due-soon'
                                  ? 'serious'
                                  : indicator === 'paid'
                                    ? 'good'
                                    : indicator === 'autopay'
                                      ? 'accent'
                                      : 'neutral'
                            }
                            icon={<span aria-hidden>{INDICATOR_META[indicator].dot}</span>}
                          >
                            {INDICATOR_META[indicator].label}
                          </Badge>
                        </Td>
                        <Td align="right">
                          <div className="flex items-center justify-end gap-2">
                            {occurrence.status !== 'PAID' && fundingAccounts.length > 0 ? (
                              <PayBillDialog
                                billName={occurrence.bill.name}
                                payeeName={occurrence.bill.payeeName}
                                defaultAmount={occurrence.amountDue.toFixed(2)}
                                defaultAccountId={occurrence.bill.fundingAccountId}
                                occurrenceId={occurrence.id}
                                accounts={fundingAccounts}
                              />
                            ) : null}
                            <OccurrenceActions
                              occurrenceId={occurrence.id}
                              isPaid={occurrence.status === 'PAID'}
                              paidSource={occurrence.paidSource}
                            />
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle>Payment history</SectionTitle>
          <Card>
            {payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Payments initiated from this dashboard appear here with their provider status."
              />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Payee</Th>
                      <Th align="right">Amount</Th>
                      <Th>Account</Th>
                      <Th>Entity</Th>
                      <Th>Status</Th>
                      <Th>Confirmed by</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <Td className="whitespace-nowrap">
                          <span className="tabular text-xs">
                            {format(payment.scheduledFor, 'MMM d, yyyy')}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-medium text-primary">{payment.payeeName}</span>
                          {payment.occurrence?.bill ? (
                            <span className="block text-xs text-muted">{payment.occurrence.bill.name}</span>
                          ) : null}
                        </Td>
                        <Td align="right" numeric className="font-medium">
                          {formatMoney(payment.amount)}
                        </Td>
                        <Td>
                          <span className="text-xs">
                            {payment.fundingAccount.name}
                            {payment.fundingAccount.mask ? ` ····${payment.fundingAccount.mask}` : ''}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-1.5 text-xs">
                            <Dot color={payment.entity.color} />
                            {payment.entity.name}
                          </span>
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              payment.status === 'COMPLETED'
                                ? 'good'
                                : payment.status === 'FAILED'
                                  ? 'critical'
                                  : payment.status === 'CANCELLED'
                                    ? 'neutral'
                                    : 'accent'
                            }
                          >
                            {payment.status.toLowerCase().replace('_', ' ')}
                          </Badge>
                        </Td>
                        <Td>
                          <span className="text-xs text-muted">
                            {payment.confirmedBy?.name ?? '—'}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <p className="mt-4 text-[11px] leading-relaxed text-muted">
                  A payment reads as complete only when the payment provider confirms it settled. Bills
                  marked paid by hand are recorded as tracking, and do not appear here.
                </p>
              </>
            )}
          </Card>
        </section>

        {reserves.length > 0 ? (
          <section>
            <SectionTitle>Cash-flow protection</SectionTitle>
            <Card>
              <p className="mb-3 text-xs text-muted">
                Before a payment is scheduled, the funding account&apos;s available balance is checked
                against these thresholds. A projected breach is a warning, not a block.
              </p>
              <ul className="space-y-1.5">
                {reserves.map((reserve) => (
                  <li key={reserve.id} className="flex items-center justify-between text-sm">
                    <span className="text-secondary">
                      {reserve.scope === 'ENTITY'
                        ? (reserve.entity?.name ?? 'Entity')
                        : reserve.scope === 'PERSONAL'
                          ? 'Personal minimum'
                          : 'Business minimum'}
                    </span>
                    <span className="tabular font-medium text-primary">
                      {formatMoney(reserve.minimumAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  )
}

function MonthLink({
  offset,
  label,
  params,
}: {
  offset: number
  label: string
  params: Record<string, string | string[] | undefined>
}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && key !== 'month') query.set(key, value)
  }
  if (offset !== 0) query.set('month', String(offset))

  return (
    <Link
      href={`/bills${query.toString() ? `?${query}` : ''}`}
      className="rounded-md border border-line px-2 py-1 text-xs text-secondary hover:text-primary"
    >
      {label}
    </Link>
  )
}
