'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/cn'
import { CADENCE_LABELS } from '@/lib/finance/recurrence'
import type { Cadence } from '@prisma/client'

/**
 * Add / Ignore / Edit on a detected recurring payment.
 *
 * A detection is a proposal and nothing more — nothing in the application acts
 * on it until the user answers here.
 */
export function DetectionActions({
  seriesId,
  merchantName,
  amount,
  cadence,
  fundingAccounts,
}: {
  seriesId: string
  merchantName: string
  amount: string
  cadence: Cadence
  fundingAccounts: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'editing'>('idle')
  const [busy, setBusy] = useState(false)
  const [editAmount, setEditAmount] = useState(amount)
  const [editCadence, setEditCadence] = useState<Cadence>(cadence)
  const [accountId, setAccountId] = useState(fundingAccounts[0]?.id ?? '')
  const [autopay, setAutopay] = useState(false)
  const [, startTransition] = useTransition()

  async function send(body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    await fetch(`/api/recurring/${seriesId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    setMode('idle')
    startTransition(() => router.refresh())
  }

  if (mode === 'editing') {
    return (
      <div className="rounded-lg border border-line bg-sunken p-3">
        <p className="mb-2 text-xs text-secondary">
          Adjust before adding <span className="font-medium text-primary">{merchantName}</span> as a bill.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted">Amount</span>
            <input
              type="text"
              inputMode="decimal"
              value={editAmount}
              onChange={(event) => setEditAmount(event.target.value)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-muted">Cadence</span>
            <select
              value={editCadence}
              onChange={(event) => setEditCadence(event.target.value as Cadence)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-primary"
            >
              {(Object.keys(CADENCE_LABELS) as Cadence[])
                .filter((key) => key !== 'IRREGULAR')
                .map((key) => (
                  <option key={key} value={key}>
                    {CADENCE_LABELS[key]}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-muted">Pay from</span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-primary"
            >
              {fundingAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={autopay}
            onChange={(event) => setAutopay(event.target.checked)}
            className="size-3.5"
          />
          This bill is on autopay
        </label>

        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              await send({ action: 'edit', averageAmount: editAmount, cadence: editCadence })
              await send({ action: 'add', fundingAccountId: accountId || null, autopay })
            }}
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            Save and add
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('idle')}
            className="rounded-md px-2 py-1 text-[11px] text-secondary disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => send({ action: 'add', fundingAccountId: accountId || null })}
        className={cn(
          'rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white',
          busy && 'opacity-60',
        )}
      >
        Add
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setMode('editing')}
        className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-primary disabled:opacity-60"
      >
        Edit
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => send({ action: 'ignore' })}
        className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-primary disabled:opacity-60"
      >
        Ignore
      </button>
    </div>
  )
}
