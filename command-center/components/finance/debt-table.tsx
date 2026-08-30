import { format } from 'date-fns'
import { Table, Th, Td, Badge } from '@/components/ui/primitives'
import { formatMoney, formatPercent } from '@/lib/finance/money'
import { accountTypeLabel } from '@/lib/finance/account-kind'
import type { DebtAccount } from '@/lib/finance/debt'

/**
 * The debt table from the brief: balance, APR, minimum payment, due date, type.
 * Every numeric column is right-aligned with tabular figures so the digits line
 * up down the column.
 */
export function DebtTable({ accounts, now }: { accounts: DebtAccount[]; now: Date }) {
  if (accounts.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">No debt accounts.</p>
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Debt</Th>
          <Th align="right">Balance</Th>
          <Th align="right">APR</Th>
          <Th align="right">Min. payment</Th>
          <Th>Due date</Th>
          <Th>Type</Th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => {
          const dueInDays = account.nextPaymentDueAt
            ? Math.ceil((account.nextPaymentDueAt.getTime() - now.getTime()) / 86_400_000)
            : null

          return (
            <tr key={account.id}>
              <Td>
                <span className="font-medium text-primary">{account.name}</span>
                <span className="block text-xs text-muted">
                  {account.institutionName}
                  {account.mask ? ` ····${account.mask}` : ''}
                </span>
              </Td>
              <Td align="right" numeric className="font-medium">
                {formatMoney(account.currentBalance)}
              </Td>
              <Td align="right" numeric>
                {account.apr !== null && account.apr !== undefined ? formatPercent(account.apr, 2) : '—'}
              </Td>
              <Td align="right" numeric>
                {account.minimumPayment ? formatMoney(account.minimumPayment) : '—'}
              </Td>
              <Td>
                {account.nextPaymentDueAt ? (
                  <span className="flex items-center gap-2">
                    <span className="tabular text-primary">
                      {format(account.nextPaymentDueAt, 'MMM d')}
                    </span>
                    {dueInDays !== null && dueInDays >= 0 && dueInDays <= 7 ? (
                      <Badge tone="serious" icon={<span aria-hidden>🔴</span>}>
                        {dueInDays === 0 ? 'Today' : `${dueInDays}d`}
                      </Badge>
                    ) : null}
                  </span>
                ) : (
                  '—'
                )}
              </Td>
              <Td>
                <span className="text-xs">{accountTypeLabel(account.type)}</span>
                <span className="block text-[11px] text-muted">
                  {account.ledger === 'BUSINESS' ? 'Business' : 'Personal'}
                </span>
              </Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
