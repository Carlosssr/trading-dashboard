import { format } from 'date-fns'
import { buildCalendar, billIndicator, INDICATOR_META, type BillOccurrenceInput } from '@/lib/finance/bills'
import { formatMoney } from '@/lib/finance/money'
import { cn } from '@/lib/cn'

/**
 * The month calendar.
 *
 * Every cell shows its bills with the same indicator vocabulary as the rest of
 * the application, and the day total is rendered as text so the information is
 * never carried by colour alone.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function BillCalendar({
  occurrences,
  month,
  today,
}: {
  occurrences: BillOccurrenceInput[]
  month: Date
  today: Date
}) {
  const days = buildCalendar(occurrences, month, today)

  return (
    <div>
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((day) => (
          <div key={day} className="pb-1.5 text-center text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {days.map((day) => (
          <div
            key={day.date.toISOString()}
            className={cn(
              'min-h-[104px] bg-surface p-1.5',
              !day.inMonth && 'bg-sunken/60',
              day.isToday && 'ring-1 ring-inset ring-accent',
            )}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={cn(
                  'tabular text-[11px]',
                  day.isToday ? 'font-semibold text-accent' : day.inMonth ? 'text-secondary' : 'text-muted',
                )}
              >
                {format(day.date, 'd')}
              </span>
              {day.occurrences.length > 0 ? (
                <span className="tabular text-[10px] font-medium text-muted">
                  {formatMoney(day.total)}
                </span>
              ) : null}
            </div>

            <ul className="space-y-0.5">
              {day.occurrences.slice(0, 3).map((occurrence) => {
                const indicator = billIndicator(occurrence, today)
                return (
                  <li
                    key={occurrence.id}
                    className="flex items-center gap-1 rounded bg-sunken px-1 py-0.5 text-[10px] leading-tight"
                    title={`${occurrence.billName} · ${formatMoney(occurrence.amountDue)} · ${
                      INDICATOR_META[indicator].label
                    }`}
                  >
                    <span aria-hidden className="text-[9px]">
                      {INDICATOR_META[indicator].dot}
                    </span>
                    <span className="truncate text-primary">{occurrence.billName}</span>
                  </li>
                )
              })}
              {day.occurrences.length > 3 ? (
                <li className="px-1 text-[10px] text-muted">+{day.occurrences.length - 3} more</li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-4">
        {(Object.keys(INDICATOR_META) as (keyof typeof INDICATOR_META)[]).map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-xs text-secondary">
            <span aria-hidden>{INDICATOR_META[key].dot}</span>
            {INDICATOR_META[key].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
