import { format } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listItems } from '@/lib/services/linking'
import { env } from '@/lib/env'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, EmptyState, SectionTitle } from '@/components/ui/primitives'
import { ConnectInstitution } from '@/components/settings/connect-institution'
import { DisconnectButton } from '@/components/settings/disconnect-button'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const [context, items] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    listItems(scope),
  ])

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Connections"
        description={`${items.length} linked institutions · ${env.aggregationProvider} provider`}
      />

      <div className="space-y-6 px-6 py-6">
        <Card>
          <CardHeader
            title="Connect an institution"
            subtitle="Credentials are entered in the provider's own flow and never reach this application"
          />
          <ConnectInstitution entities={context.entities} />
        </Card>

        <section>
          <SectionTitle>Linked institutions</SectionTitle>

          {items.length === 0 ? (
            <EmptyState
              title="Nothing connected yet"
              description="Connect an institution above to start syncing balances and transactions."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <Card key={item.id}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-primary">{item.institution.name}</p>
                      <p className="text-xs text-muted">
                        {item._count.accounts} account{item._count.accounts === 1 ? '' : 's'} ·{' '}
                        {item.provider.toLowerCase()}
                      </p>
                    </div>
                    <Badge
                      tone={
                        item.status === 'ACTIVE'
                          ? 'good'
                          : item.status === 'ERROR'
                            ? 'critical'
                            : 'warning'
                      }
                    >
                      {item.status.toLowerCase().replace('_', ' ')}
                    </Badge>
                  </div>

                  <dl className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted">Last synced</dt>
                      <dd className="text-secondary">
                        {item.lastSyncedAt ? format(item.lastSyncedAt, 'MMM d, yyyy · h:mm a') : 'Never'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Connected</dt>
                      <dd className="text-secondary">{format(item.createdAt, 'MMM d, yyyy')}</dd>
                    </div>
                  </dl>

                  {item.lastError ? (
                    <p className="mt-3 rounded-lg bg-critical-soft px-2.5 py-2 text-[11px] text-[var(--delta-down)]">
                      {item.lastError}
                    </p>
                  ) : null}

                  <div className="mt-4 border-t border-line pt-3">
                    <DisconnectButton itemId={item.id} institutionName={item.institution.name} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <Card>
          <CardHeader title="What this application stores" />
          <ul className="space-y-1.5 text-xs leading-relaxed text-secondary">
            <li>
              <span className="font-medium text-primary">No bank credentials.</span> Usernames and passwords
              are entered only in the aggregation provider&apos;s own flow, which posts them directly to the
              provider. There is no endpoint, column, or code path here capable of receiving them.
            </li>
            <li>
              <span className="font-medium text-primary">Access tokens are encrypted at rest</span> with
              AES-256-GCM and a versioned key, and are never included in any response to a browser.
            </li>
            <li>
              <span className="font-medium text-primary">Disconnecting revokes access at the provider</span>{' '}
              and deletes the local token. Accounts and transaction history are kept and marked
              disconnected — unlinking should not erase a year of records.
            </li>
          </ul>
        </Card>
      </div>
    </>
  )
}
