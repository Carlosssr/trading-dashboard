import Link from 'next/link'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { listItems } from '@/lib/services/linking'
import { computeNetWorth } from '@/lib/finance/net-worth'
import { ACCOUNT_GROUP_LABELS, accountGroup, accountTypeLabel, isLiability, type AccountGroup } from '@/lib/finance/account-kind'
import { formatMoney, formatMoneyWhole, formatPercent, sumBy, money } from '@/lib/finance/money'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, CardHeader, Dot, EmptyState, Figure, SectionTitle, Table, Td, Th } from '@/components/ui/primitives'
import { EntityPicker } from '@/components/accounts/entity-picker'

export const dynamic = 'force-dynamic'

const GROUP_ORDER: AccountGroup[] = ['cash', 'investments', 'property', 'credit', 'loans', 'other']

export default async function AccountsPage({
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

  const position = computeNetWorth(context.accounts)
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    accounts: context.accounts.filter((account) => accountGroup(account.type) === group && !account.isClosed),
  })).filter((entry) => entry.accounts.length > 0)

  const staleItems = items.filter((item) => item.status !== 'ACTIVE')

  return (
    <>
      <FilterBar
        entities={context.entities}
        showPeriod={false}
        title="Accounts"
        description={`${context.accounts.length} accounts across ${items.length} connected institutions`}
      />

      <div className="space-y-6 px-6 py-6">
        {staleItems.length > 0 ? (
          <Card className="border-serious/40 bg-warning-soft">
            <p className="text-sm font-medium text-primary">
              {staleItems.length} connection{staleItems.length === 1 ? '' : 's'} need attention
            </p>
            <ul className="mt-2 space-y-1 text-xs text-secondary">
              {staleItems.map((item) => (
                <li key={item.id}>
                  {item.institution.name} — {item.lastError ?? item.status.toLowerCase().replace('_', ' ')}
                </li>
              ))}
            </ul>
            <Link href="/settings/connections" className="mt-3 inline-block text-xs text-accent hover:underline">
              Manage connections
            </Link>
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Figure label="Total assets" value={formatMoneyWhole(position.combined.assets)} />
          </Card>
          <Card>
            <Figure label="Total liabilities" value={formatMoneyWhole(position.combined.liabilities)} />
          </Card>
          <Card>
            <Figure label="Net worth" value={formatMoneyWhole(position.combined.netWorth)} />
          </Card>
        </div>

        {grouped.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="Connect a financial institution to start tracking balances and transactions."
            action={
              <Link
                href="/settings/connections"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
              >
                Connect an institution
              </Link>
            }
          />
        ) : (
          grouped.map(({ group, accounts }) => (
            <section key={group}>
              <SectionTitle>
                {ACCOUNT_GROUP_LABELS[group]} ·{' '}
                {formatMoney(
                  sumBy(accounts, (account) =>
                    isLiability(account.type)
                      ? money(account.currentBalance).abs().negated()
                      : account.currentBalance,
                  ),
                )}
              </SectionTitle>

              <Card>
                <Table>
                  <thead>
                    <tr>
                      <Th>Account</Th>
                      <Th>Type</Th>
                      <Th>Entity</Th>
                      <Th align="right">Balance</Th>
                      <Th align="right">Available</Th>
                      <Th align="right">Limit / APR</Th>
                      <Th>Synced</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.id}>
                        <Td>
                          <span className="font-medium text-primary">{account.name}</span>
                          <span className="block text-xs text-muted">
                            {account.institutionName}
                            {account.mask ? ` ····${account.mask}` : ''}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-xs">{accountTypeLabel(account.type)}</span>
                          <span className="block text-[11px] text-muted">
                            {account.classification.replace('_', ' ').toLowerCase()}
                          </span>
                        </Td>
                        <Td>
                          {/* Reassigning moves the account's ledger and all of its
                              transactions with it, in one transaction. */}
                          <EntityPicker
                            accountId={account.id}
                            currentEntityId={account.entityId}
                            entities={context.entities}
                          />
                        </Td>
                        <Td align="right" numeric className="font-medium">
                          {formatMoney(account.currentBalance)}
                        </Td>
                        <Td align="right" numeric>
                          {account.availableBalance ? formatMoney(account.availableBalance) : '—'}
                        </Td>
                        <Td align="right" numeric>
                          {account.creditLimit ? formatMoney(account.creditLimit) : ''}
                          {account.apr ? (
                            <span className="block text-xs text-muted">{formatPercent(account.apr, 2)}</span>
                          ) : null}
                          {!account.creditLimit && !account.apr ? '—' : null}
                        </Td>
                        <Td>
                          {account.isManual ? (
                            <Badge>Manual</Badge>
                          ) : account.isDisconnected ? (
                            <Badge tone="warning">Disconnected</Badge>
                          ) : account.lastSyncedAt ? (
                            <span className="text-xs text-muted">
                              {account.lastSyncedAt.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          ) : (
                            '—'
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </section>
          ))
        )}

        <section>
          <SectionTitle>Entities</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {context.entities.map((entity) => {
              const entityAccounts = context.accounts.filter((account) => account.entityId === entity.id)
              return (
                <Card key={entity.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <Dot color={entity.color} />
                    <p className="truncate text-sm font-medium text-primary">{entity.name}</p>
                  </div>
                  <p className="text-xs text-muted">
                    {entity.ledger === 'BUSINESS' ? 'Business ledger' : 'Personal ledger'} ·{' '}
                    {entity.kind.replace('_', ' ').toLowerCase()}
                  </p>
                  <p className="tabular mt-3 text-lg font-semibold text-primary">
                    {formatMoney(
                      sumBy(entityAccounts, (account) =>
                        isLiability(account.type)
                          ? money(account.currentBalance).abs().negated()
                          : account.currentBalance,
                      ),
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {entityAccounts.length} account{entityAccounts.length === 1 ? '' : 's'}
                  </p>
                </Card>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}
