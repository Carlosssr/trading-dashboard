'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * Manual bill tracking actions.
 *
 * "Mark paid" records that the user says this bill was paid elsewhere. It is
 * deliberately separate from the Pay action, which initiates a payment — the
 * dashboard must never imply money moved when it only recorded a claim.
 */
export function OccurrenceActions({
  occurrenceId,
  isPaid,
  paidSource,
}: {
  occurrenceId: string
  isPaid: boolean
  paidSource: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function act(action: 'mark-paid' | 'skip' | 'reopen'): Promise<void> {
    setBusy(true)
    await fetch(`/api/bills/occurrences/${occurrenceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    startTransition(() => router.refresh())
  }

  if (isPaid) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted">
          {paidSource === 'transaction-match'
            ? 'Matched to a transaction'
            : paidSource === 'payment-confirmed'
              ? 'Confirmed by provider'
              : 'Marked paid'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => act('reopen')}
          className="text-[11px] text-muted underline-offset-2 hover:text-primary hover:underline disabled:opacity-60"
        >
          Reopen
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => act('mark-paid')}
        className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-primary hover:bg-sunken disabled:opacity-60"
      >
        Mark paid
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => act('skip')}
        className="rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-primary disabled:opacity-60"
      >
        Skip
      </button>
    </div>
  )
}
