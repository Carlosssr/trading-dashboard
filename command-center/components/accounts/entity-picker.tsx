'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { EntityRow } from '@/lib/services/dashboard'

/**
 * Moves an account to a different entity.
 *
 * The server does the consequential part in one database transaction: the
 * account's ledger changes with it, and so does the ledger on every one of its
 * transactions. This control just names the target and reports what moved.
 */
export function EntityPicker({
  accountId,
  currentEntityId,
  entities,
}: {
  accountId: string
  currentEntityId: string
  entities: EntityRow[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function reassign(entityId: string): Promise<void> {
    if (entityId === currentEntityId) return
    setError(null)

    const response = await fetch(`/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityId }),
    })

    if (!response.ok) {
      const data = (await response.json()) as { error?: { message: string } }
      setError(data.error?.message ?? 'Could not move this account.')
      return
    }

    startTransition(() => router.refresh())
  }

  return (
    <div>
      <select
        aria-label="Entity"
        value={currentEntityId}
        disabled={pending}
        onChange={(event) => reassign(event.target.value)}
        className="w-full max-w-[11rem] rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-primary disabled:opacity-60"
      >
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-[var(--delta-down)]">{error}</p> : null}
    </div>
  )
}
