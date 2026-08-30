'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { EntityRow } from '@/lib/services/dashboard'

/**
 * The institution link flow.
 *
 * Credentials never touch this component or our servers. With the real Plaid
 * provider the browser hands off to Plaid Link, which collects credentials and
 * returns only a short-lived public token; with the demo provider the
 * institution list stands in for that hand-off. Either way, all this component
 * ever sends us is a public token and the entity to file the accounts under.
 */

type Institution = { providerInstitutionId: string; name: string; primaryColor?: string | null }

export function ConnectInstitution({ entities }: { entities: EntityRow[] }) {
  const router = useRouter()
  const [session, setSession] = useState<{ provider: string; institutions: Institution[] } | null>(null)
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function begin(): Promise<void> {
    setBusy('token')
    setError(null)

    const response = await fetch('/api/link/token', { method: 'POST' })
    const data = (await response.json()) as {
      error?: { message: string }
      provider?: string
      linkToken?: string
      availableInstitutions?: Institution[] | null
    }
    setBusy(null)

    if (!response.ok) {
      setError(data.error?.message ?? 'Could not start the connection.')
      return
    }

    if (!data.availableInstitutions || data.availableInstitutions.length === 0) {
      // Real provider: the hosted SDK takes over from here, which is where
      // credentials are entered — never in this application.
      setError(
        'This deployment is configured for a live provider. Plaid Link opens the provider’s own secure flow; ' +
          'no credentials are entered in this application.',
      )
      return
    }

    setSession({ provider: data.provider ?? 'DEMO', institutions: data.availableInstitutions })
  }

  async function connect(institution: Institution): Promise<void> {
    setBusy(institution.providerInstitutionId)
    setError(null)

    const response = await fetch('/api/link/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Only a public token crosses this boundary.
        publicToken: `demo-public-${institution.providerInstitutionId}`,
        entityId,
      }),
    })

    const data = (await response.json()) as {
      error?: { message: string }
      institutionName?: string
      result?: { accountsUpserted: number; transactionsAdded: number }
    }
    setBusy(null)

    if (!response.ok) {
      setError(data.error?.message ?? 'Could not complete the connection.')
      return
    }

    setResult(
      `Connected ${data.institutionName}: ${data.result?.accountsUpserted ?? 0} accounts and ` +
        `${data.result?.transactionsAdded ?? 0} transactions synced.`,
    )
    setSession(null)
    startTransition(() => router.refresh())
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-secondary">File accounts under</span>
          <select
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-primary"
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name} ({entity.ledger === 'BUSINESS' ? 'business' : 'personal'})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={begin}
          disabled={busy !== null || !entityId}
          className={cn(
            'rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white',
            (busy !== null || !entityId) && 'opacity-60',
          )}
        >
          {busy === 'token' ? 'Starting…' : 'Connect an institution'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-[#8a5c00] dark:text-[#fab219]">
          {error}
        </p>
      ) : null}

      {result ? (
        <p className="mt-3 rounded-lg bg-good-soft px-3 py-2 text-xs text-[var(--delta-up)]">{result}</p>
      ) : null}

      {session ? (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted">
            Choose an institution. Accounts will be filed under{' '}
            <span className="font-medium text-primary">
              {entities.find((entity) => entity.id === entityId)?.name}
            </span>
            , and can be moved afterwards.
          </p>

          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {session.institutions.map((institution) => (
              <li key={institution.providerInstitutionId}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => connect(institution)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:bg-sunken disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ backgroundColor: institution.primaryColor ?? 'var(--color-muted)' }}
                  >
                    {busy === institution.providerInstitutionId ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Building2 className="size-3.5" />
                    )}
                  </span>
                  <span className="truncate font-medium text-primary">{institution.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
