import { AlertTriangle, Info, TriangleAlert } from 'lucide-react'
import type { InsightSeverity } from '@prisma/client'
import { cn } from '@/lib/cn'

/**
 * Insights.
 *
 * Severity is carried by an icon and a label as well as colour, never by colour
 * alone. Every string here states an observation; none recommends an action.
 */

export type InsightItem = {
  id: string
  severity: InsightSeverity
  title: string
  body: string
}

const SEVERITY = {
  CRITICAL: {
    label: 'Needs attention',
    icon: TriangleAlert,
    ring: 'border-l-critical',
    text: 'text-[var(--delta-down)]',
  },
  WARNING: {
    label: 'Worth a look',
    icon: AlertTriangle,
    ring: 'border-l-serious',
    text: 'text-[#9c4a20] dark:text-[#ec835a]',
  },
  INFO: {
    label: 'For information',
    icon: Info,
    ring: 'border-l-line-strong',
    text: 'text-muted',
  },
} as const

export function InsightList({ insights, limit }: { insights: InsightItem[]; limit?: number }) {
  const shown = limit ? insights.slice(0, limit) : insights

  if (shown.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted">
        Nothing stands out right now. Insights appear as transaction history builds up.
      </p>
    )
  }

  return (
    <ul className="space-y-2.5">
      {shown.map((insight) => {
        const meta = SEVERITY[insight.severity]
        const Icon = meta.icon

        return (
          <li key={insight.id} className={cn('border-l-2 pl-3', meta.ring)}>
            <div className="flex items-start gap-2">
              <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', meta.text)} />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-primary">{insight.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-secondary">{insight.body}</p>
                <span className="sr-only">{meta.label}</span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
