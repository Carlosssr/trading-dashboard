import type { AccountType } from '@prisma/client'

/**
 * The single definition of what each account type means financially. Net worth,
 * the debt page, and the cash tiles all read from here, which is why they cannot
 * disagree about whether a line of credit is a liability.
 */

const LIABILITY_TYPES = new Set<AccountType>([
  'CREDIT_CARD',
  'LINE_OF_CREDIT',
  'AUTO_LOAN',
  'MORTGAGE',
  'STUDENT_LOAN',
  'PERSONAL_LOAN',
  'BUSINESS_LOAN',
  'OTHER_LIABILITY',
])

const CASH_TYPES = new Set<AccountType>(['CHECKING', 'SAVINGS', 'MONEY_MARKET', 'CD'])

const INVESTMENT_TYPES = new Set<AccountType>(['INVESTMENT', 'RETIREMENT'])

const REVOLVING_TYPES = new Set<AccountType>(['CREDIT_CARD', 'LINE_OF_CREDIT'])

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.has(type)
}

export function isAsset(type: AccountType): boolean {
  return !LIABILITY_TYPES.has(type)
}

/** Spendable cash. CDs are included as cash but flagged as illiquid by callers. */
export function isCash(type: AccountType): boolean {
  return CASH_TYPES.has(type)
}

/** Cash you could actually use today — excludes CDs. */
export function isLiquidCash(type: AccountType): boolean {
  return CASH_TYPES.has(type) && type !== 'CD'
}

export function isInvestment(type: AccountType): boolean {
  return INVESTMENT_TYPES.has(type)
}

/** Revolving credit is the only kind where "utilization" is meaningful. */
export function isRevolving(type: AccountType): boolean {
  return REVOLVING_TYPES.has(type)
}

export function isLoan(type: AccountType): boolean {
  return LIABILITY_TYPES.has(type) && !REVOLVING_TYPES.has(type)
}

const LABELS: Record<AccountType, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  MONEY_MARKET: 'Money Market',
  CD: 'Certificate of Deposit',
  CREDIT_CARD: 'Credit Card',
  LINE_OF_CREDIT: 'Line of Credit',
  AUTO_LOAN: 'Auto Loan',
  MORTGAGE: 'Mortgage',
  STUDENT_LOAN: 'Student Loan',
  PERSONAL_LOAN: 'Personal Loan',
  BUSINESS_LOAN: 'Business Loan',
  INVESTMENT: 'Investment',
  RETIREMENT: 'Retirement',
  PROPERTY: 'Real Estate',
  VEHICLE: 'Vehicle',
  OTHER_ASSET: 'Other Asset',
  OTHER_LIABILITY: 'Other Liability',
}

export function accountTypeLabel(type: AccountType): string {
  return LABELS[type]
}

/** Grouping used by the accounts page and the net-worth breakdown. */
export type AccountGroup = 'cash' | 'credit' | 'loans' | 'investments' | 'property' | 'other'

export function accountGroup(type: AccountType): AccountGroup {
  if (isCash(type)) return 'cash'
  if (isRevolving(type)) return 'credit'
  if (isLoan(type)) return 'loans'
  if (isInvestment(type)) return 'investments'
  if (type === 'PROPERTY') return 'property'
  return 'other'
}

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  credit: 'Credit',
  loans: 'Loans',
  investments: 'Investments',
  property: 'Real Estate',
  other: 'Other',
}
