'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/cn'

/**
 * Category override, with the follow-up the brief asks for.
 *
 * Changing a category applies to this transaction immediately. Only then does
 * the component ask whether the change should become a rule for this merchant —
 * so the answer to the prompt is a separate, explicit decision, and dismissing
 * it leaves the single edit intact.
 */

export type CategoryOption = { id: string; name: string; parentName: string | null; group: string }

export function CategoryEditor({
  transactionId,
  merchantName,
  currentCategoryId,
  currentCategoryName,
  categories,
}: {
  transactionId: string
  merchantName: string
  currentCategoryId: string | null
  currentCategoryName: string
  categories: CategoryOption[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pendingCategory, setPendingCategory] = useState<CategoryOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function save(categoryId: string, applyToFuture: boolean, applyToPast = false): Promise<void> {
    setBusy(true)
    await fetch(`/api/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId, applyToFuture, applyToPast }),
    })
    setBusy(false)
    setEditing(false)
    setPendingCategory(null)
    startTransition(() => router.refresh())
  }

  async function choose(categoryId: string): Promise<void> {
    const category = categories.find((candidate) => candidate.id === categoryId)
    if (!category || categoryId === currentCategoryId) {
      setEditing(false)
      return
    }
    // Apply the single edit first; the rule question comes after.
    await save(categoryId, false)
    setPendingCategory(category)
  }

  if (pendingCategory) {
    return (
      <div className="rounded-lg border border-line bg-accent-soft p-2.5">
        <p className="text-xs text-primary">
          Apply <span className="font-medium">{pendingCategory.name}</span> to future transactions from{' '}
          <span className="font-medium">{merchantName}</span>?
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => save(pendingCategory.id, true, false)}
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            Yes, future only
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => save(pendingCategory.id, true, true)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-primary disabled:opacity-60"
          >
            Future and past
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPendingCategory(null)}
            className="rounded-md px-2 py-1 text-[11px] text-secondary disabled:opacity-60"
          >
            Just this one
          </button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <select
        aria-label="Category"
        autoFocus
        disabled={busy}
        defaultValue={currentCategoryId ?? ''}
        onChange={(event) => choose(event.target.value)}
        onBlur={() => setEditing(false)}
        className="w-full max-w-[13rem] rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-primary"
      >
        <option value="" disabled>
          Choose a category
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.parentName ? `${category.parentName} · ${category.name}` : category.name}
          </option>
        ))}
      </select>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'rounded-md px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-sunken',
        currentCategoryName === 'Uncategorized' ? 'text-muted italic' : 'text-secondary',
      )}
    >
      {currentCategoryName}
    </button>
  )
}
