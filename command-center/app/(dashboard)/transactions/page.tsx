import { format } from 'date-fns'
import { requireSessionOrRedirect, scopeOf } from '@/lib/auth/guards'
import { parseFilters, ledgerFilter } from '@/lib/validation/filters'
import { loadFinancialContext } from '@/lib/services/dashboard'
import { queryTransactions, listCategories } from '@/lib/services/transactions'
import { computeIncomeExpense } from '@/lib/finance/cash-flow'
import { formatMoney, formatSigned, money } from '@/lib/finance/money'
import { describeRange } from '@/lib/finance/periods'
import { FilterBar } from '@/components/layout/filter-bar'
import { Badge, Card, Dot, EmptyState, Figure, Table, Td, Th } from '@/components/ui/primitives'
import { CategoryEditor } from '@/components/transactions/category-editor'
import { TransactionSearch } from '@/components/transactions/transaction-search'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSessionOrRedirect()
  const scope = scopeOf(session)
  const now = new Date()
  const params = await searchParams
  const filters = parseFilters(params, now)

  const search = typeof params.q === 'string' ? params.q : undefined
  const uncategorizedOnly = params.uncategorized === '1'
  const includeTransfers = params.transfers === '1'

  const [context, page, categories] = await Promise.all([
    loadFinancialContext(scope, filters, now),
    queryTransactions(
      scope,
      {
        ...(ledgerFilter(filters.ledger) ? { ledger: ledgerFilter(filters.ledger)! } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
        from: filters.range.start,
        to: filters.range.end,
        ...(search ? { search } : {}),
        uncategorizedOnly,
        includeTransfers,
      },
      { limit: 150 },
    ),
    listCategories(scope),
  ])

  const categoryOptions = categories
    .filter((category) => category.group !== 'TRANSFER' || includeTransfers)
    .map((category) => ({
      id: category.id,
      name: category.name,
      parentName: category.parent?.name ?? null,
      group: category.group,
    }))

  const flow = computeIncomeExpense(context.transactions)

  return (
    <>
      <FilterBar
        entities={context.entities}
        title="Transactions"
        description={`${page.total} transactions · ${describeRange(filters.range)}`}
      />

      <div className="space-y-4 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <Figure scale="md" label="Money in" value={formatMoney(flow.income)} />
          </Card>
          <Card>
            <Figure scale="md" label="Money out" value={formatMoney(flow.expenses)} />
          </Card>
          <Card>
            <Figure
              scale="md"
              label="Net"
              value={formatMoney(flow.net)}
              tone={flow.net.isNegative() ? 'negative' : 'positive'}
            />
          </Card>
        </div>

        <TransactionSearch
          initialQuery={search ?? ''}
          uncategorizedOnly={uncategorizedOnly}
          includeTransfers={includeTransfers}
        />

        <Card>
          {page.transactions.length === 0 ? (
            <EmptyState
              title="No transactions match these filters"
              description="Try widening the period, or clearing the search."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Merchant</Th>
                  <Th>Category</Th>
                  <Th>Account</Th>
                  <Th>Entity</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {page.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <Td className="whitespace-nowrap">
                      <span className="tabular text-xs">{format(transaction.postedAt, 'MMM d')}</span>
                      <span className="block text-[11px] text-muted">
                        {format(transaction.postedAt, 'yyyy')}
                      </span>
                    </Td>

                    <Td>
                      <span className="font-medium text-primary">
                        {transaction.merchantName ?? transaction.rawName}
                      </span>
                      <span className="block max-w-[22rem] truncate text-[11px] text-muted">
                        {transaction.rawName}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {transaction.isRecurring ? <Badge>Recurring</Badge> : null}
                        {transaction.isTransfer ? <Badge tone="accent">Transfer</Badge> : null}
                        {transaction.pending ? <Badge tone="warning">Pending</Badge> : null}
                      </span>
                    </Td>

                    <Td>
                      <CategoryEditor
                        transactionId={transaction.id}
                        merchantName={transaction.merchantName ?? transaction.rawName}
                        currentCategoryId={transaction.categoryId}
                        currentCategoryName={transaction.category?.name ?? 'Uncategorized'}
                        categories={categoryOptions}
                      />
                    </Td>

                    <Td>
                      <span className="text-xs">{transaction.account.name}</span>
                      <span className="block text-[11px] text-muted">
                        {transaction.account.institutionName}
                        {transaction.account.mask ? ` ····${transaction.account.mask}` : ''}
                      </span>
                    </Td>

                    <Td>
                      <span className="flex items-center gap-1.5 text-xs">
                        <Dot color={transaction.entity.color} />
                        {transaction.entity.name}
                      </span>
                    </Td>

                    <Td
                      align="right"
                      numeric
                      className={
                        money(transaction.amount).greaterThan(0)
                          ? 'font-medium text-[var(--delta-up)]'
                          : 'font-medium'
                      }
                    >
                      {formatSigned(transaction.amount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {page.nextCursor ? (
            <p className="mt-4 text-center text-xs text-muted">
              Showing the most recent {page.transactions.length} of {page.total}. Narrow the period or
              search to see the rest.
            </p>
          ) : null}
        </Card>
      </div>
    </>
  )
}
