import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The small set of presentational pieces every page is built from. No data
 * fetching and no Prisma — these take values and render them.
 */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(11,11,11,0.04)]',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-primary">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{children}</h2>
      {action}
    </div>
  )
}

/**
 * A headline figure. `scale` controls emphasis: the dashboard's net-worth
 * number is `hero`, tile values are `lg`, table-adjacent values are `md`.
 */
export function Figure({
  value,
  label,
  delta,
  scale = 'lg',
  tone = 'default',
  className,
}: {
  value: string
  label?: ReactNode
  delta?: ReactNode
  scale?: 'hero' | 'lg' | 'md'
  tone?: 'default' | 'positive' | 'negative'
  className?: string
}) {
  const sizes = {
    hero: 'text-[2.75rem] leading-[1.05]',
    lg: 'text-2xl leading-tight',
    md: 'text-lg leading-tight',
  }

  return (
    <div className={className}>
      {label ? (
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted">{label}</p>
      ) : null}
      <p
        className={cn(
          'figure font-semibold',
          sizes[scale],
          tone === 'positive' && 'text-[var(--delta-up)]',
          tone === 'negative' && 'text-[var(--delta-down)]',
          tone === 'default' && 'text-primary',
        )}
      >
        {value}
      </p>
      {delta ? <div className="mt-1.5">{delta}</div> : null}
    </div>
  )
}

/**
 * A period-over-period change. Direction is carried by the arrow glyph and the
 * sign as well as the colour, so it is never colour-alone.
 */
export function Delta({
  value,
  suffix,
  /** Set when a decrease is the good outcome, e.g. spending. */
  invert = false,
}: {
  value: number | null
  suffix?: string
  invert?: boolean
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-xs text-muted">No prior period to compare</span>
  }

  const rising = value >= 0
  const good = invert ? !rising : rising

  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 text-xs font-medium',
        good ? 'text-[var(--delta-up)]' : 'text-[var(--delta-down)]',
      )}
    >
      <span aria-hidden>{rising ? '▲' : '▼'}</span>
      {`${rising ? '+' : ''}${(value * 100).toFixed(1)}%`}
      {suffix ? <span className="font-normal text-muted">{suffix}</span> : null}
    </span>
  )
}

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'serious' | 'critical'

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  icon?: ReactNode
  className?: string
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-sunken text-secondary border-line',
    accent: 'bg-accent-soft text-[var(--accent-ink)] border-transparent',
    good: 'bg-good-soft text-[var(--delta-up)] border-transparent',
    warning: 'bg-warning-soft text-[#8a5c00] dark:text-[#fab219] border-transparent',
    serious: 'bg-warning-soft text-[#9c4a20] dark:text-[#ec835a] border-transparent',
    critical: 'bg-critical-soft text-[var(--delta-down)] border-transparent',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** Horizontal meter for utilization and share-of-total. */
export function Meter({
  value,
  tone = 'accent',
  label,
}: {
  /** 0..1, clamped for display but the label still shows the true figure. */
  value: number
  tone?: 'accent' | 'good' | 'warning' | 'critical'
  label?: string
}) {
  const width = Math.max(0, Math.min(1, value)) * 100
  const colors = {
    accent: 'bg-accent',
    good: 'bg-good',
    warning: 'bg-warning',
    critical: 'bg-critical',
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
        <div className={cn('h-full rounded-full', colors[tone])} style={{ width: `${width}%` }} />
      </div>
      {label ? <span className="tabular w-11 shrink-0 text-right text-xs text-secondary">{label}</span> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-primary">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Wide financial tables scroll inside their own container rather than
    // forcing the page to scroll sideways.
    <div className="-mx-5 overflow-x-auto px-5">
      <table className={cn('w-full min-w-[640px] border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <th
      className={cn(
        // Columns need real horizontal separation: without it an amount and the
        // date beside it run together into "$448.00Sep 4".
        'border-b border-line px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted first:pl-0 last:pr-0',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      scope="col"
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  numeric = false,
  className,
}: {
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  className?: string
}) {
  return (
    <td
      className={cn(
        'border-b border-line/60 px-3 py-2.5 text-secondary first:pl-0 last:pr-0',
        numeric && 'tabular text-primary',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  )
}

/** Small coloured dot used to carry entity identity beside its name. */
export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  )
}

export function KeyValue({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular text-sm font-medium text-primary">{value}</dd>
    </div>
  )
}
