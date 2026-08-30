import type { AccountType, Ledger } from '@prisma/client'
import { isAsset, isCash, isInvestment, isLiquidCash, accountGroup, type AccountGroup } from './account-kind'
import { money, sum, sumBy, ZERO, type Money, type MoneyInput } from './money'

/**
 * Total Financial Position: Assets − Liabilities = Net Worth.
 *
 * The personal and business figures are computed from two disjoint sets of
 * accounts and the combined figure is the sum of those two subtotals. There is
 * no query anywhere that mixes the ledgers before subtotalling — that is the
 * structural half of "do not combine business and personal accounting".
 */

export type PositionAccount = {
  id: string
  type: AccountType
  ledger: Ledger
  entityId: string
  currentBalance: MoneyInput
  availableBalance?: MoneyInput
  creditLimit?: MoneyInput
  includeInNetWorth: boolean
  isClosed: boolean
}

export type Position = {
  assets: Money
  liabilities: Money
  netWorth: Money
  byGroup: Record<AccountGroup, Money>
}

export type NetWorthBreakdown = {
  personal: Position
  business: Position
  combined: Position
}

const EMPTY_GROUPS = (): Record<AccountGroup, Money> => ({
  cash: ZERO,
  credit: ZERO,
  loans: ZERO,
  investments: ZERO,
  property: ZERO,
  other: ZERO,
})

/**
 * Liability balances are stored as positive magnitudes (a card with $2,400 owed
 * has `currentBalance` of 2400), so liabilities are summed as-is rather than
 * negated. `Math.abs` guards against a provider that reports them signed.
 */
export function computePosition(accounts: PositionAccount[]): Position {
  const included = accounts.filter((a) => a.includeInNetWorth && !a.isClosed)

  const assets = sumBy(
    included.filter((a) => isAsset(a.type)),
    (a) => a.currentBalance,
  )
  const liabilities = sumBy(
    included.filter((a) => !isAsset(a.type)),
    (a) => money(a.currentBalance).abs(),
  )

  const byGroup = EMPTY_GROUPS()
  for (const account of included) {
    const group = accountGroup(account.type)
    const value = isAsset(account.type)
      ? money(account.currentBalance)
      : money(account.currentBalance).abs().negated()
    byGroup[group] = byGroup[group].plus(value)
  }

  return { assets, liabilities, netWorth: assets.minus(liabilities), byGroup }
}

export function computeNetWorth(accounts: PositionAccount[]): NetWorthBreakdown {
  const personal = computePosition(accounts.filter((a) => a.ledger === 'PERSONAL'))
  const business = computePosition(accounts.filter((a) => a.ledger === 'BUSINESS'))

  return {
    personal,
    business,
    combined: {
      assets: personal.assets.plus(business.assets),
      liabilities: personal.liabilities.plus(business.liabilities),
      netWorth: personal.netWorth.plus(business.netWorth),
      byGroup: (Object.keys(personal.byGroup) as AccountGroup[]).reduce((acc, group) => {
        acc[group] = personal.byGroup[group].plus(business.byGroup[group])
        return acc
      }, EMPTY_GROUPS()),
    },
  }
}

export type CashPosition = {
  /** Total across all cash accounts, including illiquid ones like CDs. */
  total: Money
  /** What could actually be spent today: available balance where reported. */
  available: Money
  /** Excludes CDs. */
  liquid: Money
  accountCount: number
}

export function computeCash(accounts: PositionAccount[]): CashPosition {
  const cashAccounts = accounts.filter((a) => !a.isClosed && isCash(a.type))

  return {
    total: sumBy(cashAccounts, (a) => a.currentBalance),
    // Fall back to the current balance when a provider reports no available
    // figure, which is the norm for savings accounts.
    available: sumBy(cashAccounts, (a) => a.availableBalance ?? a.currentBalance),
    liquid: sumBy(
      cashAccounts.filter((a) => isLiquidCash(a.type)),
      (a) => a.currentBalance,
    ),
    accountCount: cashAccounts.length,
  }
}

export function computeInvestments(accounts: PositionAccount[]): Money {
  return sumBy(
    accounts.filter((a) => !a.isClosed && isInvestment(a.type)),
    (a) => a.currentBalance,
  )
}

export type CashByLedger = {
  personal: CashPosition
  business: CashPosition
  total: Money
}

export function computeCashByLedger(accounts: PositionAccount[]): CashByLedger {
  const personal = computeCash(accounts.filter((a) => a.ledger === 'PERSONAL'))
  const business = computeCash(accounts.filter((a) => a.ledger === 'BUSINESS'))
  return { personal, business, total: personal.total.plus(business.total) }
}

/** Cash held by a single entity — what the business dashboard shows per entity. */
export function cashForEntity(accounts: PositionAccount[], entityId: string): Money {
  return sum(
    accounts
      .filter((a) => a.entityId === entityId && !a.isClosed && isCash(a.type))
      .map((a) => a.currentBalance),
  )
}
