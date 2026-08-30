import { format, differenceInCalendarDays } from 'date-fns'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatMoney } from '@/lib/finance/money'
import { billIndicator, INDICATOR_META, type BillOccurrenceInput } from '@/lib/finance/bills'

/**
 * Upcoming payments.
 *
 * Status is an emoji indicator plus a text label, so it survives colour-blind
 * viewing and screen readers. A bill shows as paid only when its occurrence
 * says so — a scheduled payment does not change this list's reading of it.
 */
export function UpcomingList({
  occurrences,
  now,
  emptyMessage = 'Nothing due in this window.',
}: {
  occurrences: BillOccurrenceInput[]
  now: Date
  emptyMessage?: string
}) {
  if (occurrences.length === 0) {
    return <EmptyState title={emptyMessage} />
  }

  return (
    <ul className="divide-y divide-line/60">
      {occurrences.map((occurrence) => {
        const indicator = billIndicator(occurrence, now)
        const meta = INDICATOR_META[indicator]
        const daysAway = differenceInCalendarDays(occurrence.dueAt, now)

        return (
          <li key={occurrence.id} className="flex items-center justify-between gap-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="text-sm">
                {meta.dot}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-primary">{occurrence.billName}</p>
                <p className="truncate text-xs text-muted">
                  {occurrence.entityName}
                  {occurrence.fundingAccountName ? ` · ${occurrence.fundingAccountName}` : ''}
                  {occurrence.fundingAccountMask ? ` ····${occurrence.fundingAccountMask}` : ''}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="tabular text-[13px] font-medium text-primary">
                  {formatMoney(occurrence.amountDue)}
                </p>
                <p className="text-xs text-muted">
                  {format(occurrence.dueAt, 'MMM d')}
                  {daysAway === 0
                    ? ' · today'
                    : daysAway > 0
                      ? ` · in ${daysAway}d`
                      : ` · ${Math.abs(daysAway)}d ago`}
                </p>
              </div>
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
              >
                {meta.label}
              </Badge>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
