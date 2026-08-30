import Link from 'next/link'
import { format } from 'date-fns'
import { requireSessionOrRedirect, scopeOf, CAPABILITIES } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listCashReserves } from '@/lib/services/entities'
import { listRules } from '@/lib/services/rules'
import { listAudit } from '@/lib/services/audit'
import { env } from '@/lib/env'
import { formatMoney } from '@/lib/finance/money'
import { CADENCE_LABELS } from '@/lib/finance/recurrence'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, Dot, EmptyState, KeyValue, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const filters = parseFilters(await searchParams, now)

  const canViewAudit = (CAPABILITIES.viewAudit as readonly string[]).includes(session.role)

  const [context, reserves, rules, audit] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    listCashReserves(scope),
    listRules(scope),
    canViewAudit ? listAudit({ workspaceId: scope.workspaceId, limit: 40 }) : Promise.resolve([]),
  ])

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Settings"
        description={session.workspaceName}
      />

      <div className="space-y-6 px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Account" />
            <dl className="space-y-0">
              <KeyValue label="Name" value={session.name} />
              <KeyValue label="Email" value={session.email} />
              <KeyValue label="Role" value={session.role.toLowerCase()} />
              <KeyValue
                label="Two-factor"
                value={
                  session.mfaEnabled ? (
                    <Badge tone="good">Enabled</Badge>
                  ) : (
                    <Badge tone="warning">Not enabled</Badge>
                  )
                }
              />
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Two-factor authentication uses a standard authenticator app, with ten single-use backup
              codes. Enrolment requires proving a valid code first, so a mis-scanned code cannot lock you
              out.
            </p>
          </Card>

          <Card>
            <CardHeader title="Data connections" />
            <dl className="space-y-0">
              <KeyValue label="Aggregation provider" value={env.aggregationProvider} />
              <KeyValue label="Linked institutions" value={String(context.accounts.filter((a) => !a.isManual).length)} />
              <KeyValue label="Entities" value={String(context.entities.length)} />
            </dl>
            <Link
              href="/settings/connections"
              className="mt-3 inline-block text-xs text-accent hover:underline"
            >
              Manage connections
            </Link>
          </Card>

          <Card>
            <CardHeader title="Cash reserve thresholds" subtitle="Checked before a payment is scheduled" />
            {reserves.length === 0 ? (
              <p className="py-3 text-xs text-muted">None set.</p>
            ) : (
              <dl className="space-y-0">
                {reserves.map((reserve) => (
                  <KeyValue
                    key={reserve.id}
                    label={
                      reserve.scope === 'ENTITY'
                        ? (reserve.entity?.name ?? 'Entity')
                        : reserve.scope === 'PERSONAL'
                          ? 'Personal minimum'
                          : 'Business minimum'
                    }
                    value={formatMoney(reserve.minimumAmount)}
                  />
                ))}
              </dl>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              A payment that would breach a threshold produces a warning at confirmation time. It is a
              warning, not a block.
            </p>
          </Card>
        </div>

        <section>
          <SectionTitle>Entities</SectionTitle>
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Entity</Th>
                  <Th>Ledger</Th>
                  <Th>Kind</Th>
                  <Th align="right">Minimum cash</Th>
                </tr>
              </thead>
              <tbody>
                {context.entities.map((entity) => (
                  <tr key={entity.id}>
                    <Td>
                      <span className="flex items-center gap-2 font-medium text-primary">
                        <Dot color={entity.color} />
                        {entity.name}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={entity.ledger === 'BUSINESS' ? 'accent' : 'neutral'}>
                        {entity.ledger === 'BUSINESS' ? 'Business' : 'Personal'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="text-xs">{entity.kind.replace(/_/g, ' ').toLowerCase()}</span>
                    </Td>
                    <Td align="right" numeric>
                      {entity.minCashReserve ? formatMoney(entity.minCashReserve) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-4 text-[11px] leading-relaxed text-muted">
              An entity&apos;s ledger is fixed once created. Moving an account between entities moves its
              ledger and all of its transactions with it, in one database transaction — so the two sets of
              books can never end up disagreeing about which one a transaction belongs to.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle>Rules</SectionTitle>
          <Card>
            {rules.length === 0 ? (
              <EmptyState
                title="No rules yet"
                description="Changing a transaction's category offers to create a rule for that merchant."
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Match</Th>
                    <Th>Category</Th>
                    <Th>Cadence</Th>
                    <Th>Pay from</Th>
                    <Th align="right">Applied</Th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <Td>
                        <span className="font-medium text-primary">{rule.pattern}</span>
                        <span className="block text-[11px] text-muted">
                          {rule.matchType.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs">{rule.category?.name ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs">{rule.cadence ? CADENCE_LABELS[rule.cadence] : '—'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs">{rule.fundingAccount?.name ?? '—'}</span>
                      </Td>
                      <Td align="right" numeric>
                        {rule.appliedCount}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>

        {canViewAudit ? (
          <section>
            <SectionTitle>Audit log</SectionTitle>
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th>Actor</Th>
                    <Th>Resource</Th>
                    <Th>From</Th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <Td className="whitespace-nowrap">
                        <span className="tabular text-xs">
                          {format(entry.createdAt, 'MMM d, h:mm a')}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs font-medium text-primary">{entry.action}</span>
                      </Td>
                      <Td>
                        <span className="text-xs">{entry.user?.email ?? 'system'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-muted">{entry.resourceType ?? '—'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-muted">{entry.ipAddress ?? '—'}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-4 text-[11px] leading-relaxed text-muted">
                The audit log is append-only: no service in this application can update or delete an entry.
                It records authentication, institution linking, sync runs, entity reassignment, rule
                changes, and every step of the payment lifecycle.
              </p>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  )
}
