'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * Disconnecting is not reversible from here, so it asks first and says plainly
 * what is kept: access is revoked and the token deleted, but the account and
 * transaction history stay.
 */
export function DisconnectButton({
  itemId,
  institutionName,
}: {
  itemId: string
  institutionName: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function disconnect(): Promise<void> {
    setBusy(true)
    setError(null)

    const response = await fetch(`/api/link/items/${itemId}`, { method: 'DELETE' })
    setBusy(false)

    if (!response.ok) {
      const data = (await response.json()) as { error?: { message: string } }
      setError(data.error?.message ?? 'Could not disconnect.')
      return
    }

    setConfirming(false)
    startTransition(() => router.refresh())
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-muted underline-offset-2 hover:text-[var(--delta-down)] hover:underline"
      >
        Disconnect
      </button>
    )
  }

  return (
    <div>
      <p className="text-xs text-secondary">
        Disconnect {institutionName}? Access is revoked at the provider and the stored token is deleted.
        Existing accounts and transactions are kept.
      </p>
      {error ? <p className="mt-1.5 text-[11px] text-[var(--delta-down)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={disconnect}
          className="rounded-md bg-critical px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-[11px] text-secondary disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
