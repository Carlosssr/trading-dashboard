'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Search and the two list toggles. Like the rest of the filters these live in
 * the URL rather than component state, so a filtered list can be linked to.
 */
export function TransactionSearch({
  initialQuery,
  uncategorizedOnly,
  includeTransfers,
}: {
  initialQuery: string
  uncategorizedOnly: boolean
  includeTransfers: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)
  const [isPending, startTransition] = useTransition()

  function update(changes: Record<string, string | null>): void {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    startTransition(() => router.push(`${pathname}${params.toString() ? `?${params}` : ''}`))
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    update({ q: query })
  }

  return (
    <form
      onSubmit={submit}
      className={cn('flex flex-wrap items-center gap-2', isPending && 'opacity-60')}
    >
      <div className="relative flex-1 min-w-[16rem]">
        <Search aria-hidden className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search merchant, description, or notes"
          aria-label="Search transactions"
          className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-primary placeholder:text-muted"
        />
      </div>

      <Toggle
        label="Uncategorized only"
        active={uncategorizedOnly}
        onClick={() => update({ uncategorized: uncategorizedOnly ? null : '1' })}
      />
      <Toggle
        label="Show transfers"
        active={includeTransfers}
        onClick={() => update({ transfers: includeTransfers ? null : '1' })}
      />
    </form>
  )
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-transparent bg-accent-soft text-[var(--accent-ink)]'
          : 'border-line bg-surface text-secondary hover:text-primary',
      )}
    >
      {label}
    </button>
  )
}
