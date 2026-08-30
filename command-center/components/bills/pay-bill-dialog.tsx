'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/cn'

/**
 * The two-phase payment flow, rendered.
 *
 * Step one asks the server to prepare a payment; the server answers with the
 * exact sentence to approve, any cash-reserve warnings, and a single-use token.
 * Step two sends that token back. The dialog never composes the sentence
 * itself — it shows what the server recorded it would ask, which is the same
 * string kept in the audit trail.
 */

export type FundingAccount = {
  id: string
  label: string
  availableBalance: string | null
}

type Confirmation = {
  paymentId: string
  sentence: string
  warnings: string[]
  token: string
  amount: string
  scheduledFor: string
  fundingAccountLabel: string
  providerSupportsInitiation: boolean
}

export function PayBillDialog({
  billName,
  payeeName,
  defaultAmount,
  defaultAccountId,
  occurrenceId,
  accounts,
  trigger,
}: {
  billName: string
  payeeName: string
  defaultAmount: string
  defaultAccountId: string | null
  occurrenceId: string | null
  accounts: FundingAccount[]
  trigger?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(defaultAmount)
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? '')
  const [scheduledFor, setScheduledFor] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [memo, setMemo] = useState('')

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()

  function reset(): void {
    setConfirmation(null)
    setResult(null)
    setError(null)
    setAmount(defaultAmount)
    setMemo('')
  }

  async function prepare(): Promise<void> {
    setBusy(true)
    setError(null)

    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fundingAccountId: accountId,
        payeeName,
        amount,
        scheduledFor,
        billOccurrenceId: occurrenceId,
        memo: memo || null,
      }),
    })

    const data = (await response.json()) as {
      error?: { message: string }
      confirmation?: Confirmation
    }
    setBusy(false)

    if (!response.ok || !data.confirmation) {
      setError(data.error?.message ?? 'Could not prepare this payment.')
      return
    }
    setConfirmation(data.confirmation)
  }

  async function confirm(): Promise<void> {
    if (!confirmation) return
    setBusy(true)
    setError(null)

    const response = await fetch(`/api/payments/${confirmation.paymentId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: confirmation.token }),
    })

    const data = (await response.json()) as {
      error?: { message: string }
      payment?: { status: string }
    }
    setBusy(false)

    if (!response.ok) {
      setError(data.error?.message ?? 'The payment could not be submitted.')
      return
    }

    setResult(
      data.payment?.status === 'SCHEDULED'
        ? 'Payment scheduled. It will show as paid once the provider confirms it settled.'
        : 'Payment submitted. It will show as paid once the provider confirms it settled.',
    )
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-primary hover:bg-sunken"
      >
        {trigger ?? 'Pay'}
      </button>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pay ${billName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-primary">
              {confirmation ? 'Confirm payment' : `Pay ${billName}`}
            </h2>
            <p className="mt-0.5 text-xs text-muted">{payeeName}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setOpen(false)
              reset()
            }}
            className="text-muted hover:text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        {result ? (
          <div>
            <p className="rounded-lg bg-good-soft px-3 py-2 text-xs text-[var(--delta-up)]">{result}</p>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                reset()
              }}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Done
            </button>
          </div>
        ) : confirmation ? (
          <div>
            {/* The server's own sentence, verbatim. */}
            <p className="text-sm leading-relaxed text-primary">{confirmation.sentence}</p>

            {confirmation.warnings.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {confirmation.warnings.map((warning) => (
                  <li
                    key={warning}
                    className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-[#8a5c00] dark:text-[#fab219]"
                  >
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-3 text-xs text-muted">
              Scheduled for {format(new Date(confirmation.scheduledFor), 'MMMM d, yyyy')}.
            </p>

            {error ? (
              <p role="alert" className="mt-3 rounded-lg bg-critical-soft px-3 py-2 text-xs text-[var(--delta-down)]">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className={cn(
                  'flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white',
                  busy && 'opacity-60',
                )}
              >
                {busy ? 'Submitting…' : 'Confirm and pay'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmation(null)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-secondary"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Labeled label="Amount">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary"
              />
            </Labeled>

            <Labeled label="Pay from">
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                    {account.availableBalance ? ` — ${account.availableBalance} available` : ''}
                  </option>
                ))}
              </select>
            </Labeled>

            <Labeled label="Payment date">
              <input
                type="date"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
                className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary"
              />
            </Labeled>

            <Labeled label="Memo">
              <input
                type="text"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary placeholder:text-muted"
              />
            </Labeled>

            {error ? (
              <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-xs text-[var(--delta-down)]">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={busy || !accountId}
              onClick={prepare}
              className={cn(
                'w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white',
                (busy || !accountId) && 'opacity-60',
              )}
            >
              {busy ? 'Checking…' : 'Review payment'}
            </button>
            <p className="text-center text-[11px] text-muted">
              Nothing is sent until you confirm on the next step.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      {children}
    </label>
  )
}
