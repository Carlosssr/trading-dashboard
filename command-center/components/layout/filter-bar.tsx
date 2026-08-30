'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PERIOD_LABELS, PERIOD_KEYS, type PeriodKey } from '@/lib/finance/periods'
import type { EntityRow } from '@/lib/services/dashboard'

/**
 * The filter triple shared by every dashboard page: ledger scope, entity, and
 * period. Selections live in the URL, so a filtered view is linkable and the
 * back button behaves.
 */

const LEDGERS = [
  { value: 'all', label: 'All' },
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
] as const

export function FilterBar({
  entities,
  showPeriod = true,
  title,
  description,
}: {
  entities: EntityRow[]
  showPeriod?: boolean
  title: string
  description?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const ledger = searchParams.get('ledger') ?? 'all'
  const entityId = searchParams.get('entityId') ?? ''
  const period = (searchParams.get('period') ?? 'this-month') as PeriodKey

  function update(changes: Record<string, string | null>): void {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    startTransition(() => {
      router.push(`${pathname}${params.toString() ? `?${params}` : ''}`)
    })
  }

  // Choosing an entity implies its ledger, so the two controls cannot be left
  // contradicting each other.
  function selectEntity(nextEntityId: string): void {
    if (!nextEntityId) {
      update({ entityId: null })
      return
    }
    const entity = entities.find((candidate) => candidate.id === nextEntityId)
    update({
      entityId: nextEntityId,
      ledger: entity ? entity.ledger.toLowerCase() : ledger,
    })
  }

  const visibleEntities =
    ledger === 'all' ? entities : entities.filter((entity) => entity.ledger.toLowerCase() === ledger)

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-plane/95 backdrop-blur">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-primary">{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>

        <div
          className={cn('flex flex-wrap items-center gap-2', isPending && 'opacity-60')}
          aria-busy={isPending}
        >
          <div
            role="group"
            aria-label="Ledger"
            className="flex rounded-lg border border-line bg-surface p-0.5"
          >
            {LEDGERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={ledger === option.value}
                onClick={() => update({ ledger: option.value === 'all' ? null : option.value, entityId: null })}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  ledger === option.value
                    ? 'bg-primary text-[var(--surface)]'
                    : 'text-secondary hover:text-primary',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Entity"
            value={entityId}
            onChange={(event) => selectEntity(event.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-primary"
          >
            <option value="">All entities</option>
            {visibleEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>

          {showPeriod ? (
            <select
              aria-label="Period"
              value={period}
              onChange={(event) => update({ period: event.target.value })}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-primary"
            >
              {PERIOD_KEYS.filter((key) => key !== 'custom').map((key) => (
                <option key={key} value={key}>
                  {PERIOD_LABELS[key]}
                </option>
              ))}
            </select>
          ) : null}

          <SyncButton />
        </div>
      </div>
    </header>
  )
}

function SyncButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function sync(): Promise<void> {
    await fetch('/api/sync', { method: 'POST' })
    startTransition(() => router.refresh())
  }

  return (
    <button
      type="button"
      onClick={sync}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors hover:text-primary disabled:opacity-60"
    >
      <RefreshCw aria-hidden className={cn('size-3.5', isPending && 'animate-spin')} />
      {isPending ? 'Syncing' : 'Sync'}
    </button>
  )
}
