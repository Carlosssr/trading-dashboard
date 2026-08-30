import type { AccountType } from '@prisma/client'
import type { Cadence } from '@prisma/client'
import type { NormalizedInstitution } from '../types'

/**
 * The synthetic institution catalog behind the demo provider.
 *
 * This is what lets the entire application — linking, sync, categorization,
 * recurrence detection, bills, insights — be run and reviewed without Plaid
 * credentials. The data is deliberately realistic: real cadences, plausible
 * balances, and recurring merchants that the detector has to actually find.
 */

export type RecurringSpec = {
  merchant: string
  rawName: string
  /** Negative for outflows, positive for inflows. */
  amount: number
  cadence: Cadence
  dayOfMonth?: number
  /** Random variation applied per occurrence, as a fraction of the amount. */
  jitter?: number
}

export type DiscretionarySpec = {
  merchant: string
  rawName?: string
  min: number
  max: number
  /** Roughly how many times a month this happens. */
  perMonth: number
}

export type AccountTemplate = {
  key: string
  name: string
  officialName: string
  mask: string
  type: AccountType
  subtype: string
  currentBalance: number
  availableBalance?: number
  creditLimit?: number
  apr?: number
  minimumPayment?: number
  /** Days from today until the next payment is due. */
  dueInDays?: number
  statementBalance?: number
  originalPrincipal?: number
  maturityMonths?: number
  recurring?: RecurringSpec[]
  discretionary?: DiscretionarySpec[]
  holdings?: { name: string; ticker: string; quantity: number; price: number; costBasis: number }[]
}

export type InstitutionTemplate = NormalizedInstitution & {
  id: string
  accounts: AccountTemplate[]
}

export const DEMO_INSTITUTIONS: InstitutionTemplate[] = [
  {
    id: 'ins_chase',
    providerInstitutionId: 'ins_chase',
    name: 'Chase',
    primaryColor: '#117ACA',
    website: 'https://chase.com',
    accounts: [
      {
        key: 'chase_checking',
        name: 'Total Checking',
        officialName: 'Chase Total Checking',
        mask: '4471',
        type: 'CHECKING',
        subtype: 'checking',
        currentBalance: 18432.11,
        availableBalance: 18132.11,
        recurring: [
          {
            merchant: 'Meridian Health Payroll',
            rawName: 'DIRECT DEP MERIDIAN HEALTH PAYROLL',
            amount: 4180,
            cadence: 'BIWEEKLY',
          },
          {
            merchant: 'Wells Fargo Home Mortgage',
            rawName: 'WF HOME MTG AUTOPAY',
            amount: -2847.32,
            cadence: 'MONTHLY',
            dayOfMonth: 1,
          },
          {
            merchant: 'State Farm',
            rawName: 'STATE FARM INSURANCE PMT',
            amount: -185,
            cadence: 'MONTHLY',
            dayOfMonth: 8,
          },
          {
            merchant: 'Verizon',
            rawName: 'VERIZON WIRELESS AUTOPAY',
            amount: -94.2,
            cadence: 'MONTHLY',
            dayOfMonth: 14,
            jitter: 0.03,
          },
          {
            merchant: 'Comcast Xfinity',
            rawName: 'COMCAST XFINITY WEB PMT',
            amount: -89.99,
            cadence: 'MONTHLY',
            dayOfMonth: 18,
          },
          {
            merchant: 'City of Austin Utilities',
            rawName: 'CITY OF AUSTIN UTIL',
            amount: -142.5,
            cadence: 'MONTHLY',
            dayOfMonth: 22,
            jitter: 0.22,
          },
        ],
        discretionary: [
          { merchant: 'H-E-B', min: 48, max: 210, perMonth: 5 },
          { merchant: 'Amazon', rawName: 'AMZN MKTP US*RT4D9', min: 15, max: 180, perMonth: 4 },
          { merchant: 'Shell', rawName: 'SHELL OIL 57442136', min: 32, max: 78, perMonth: 3 },
        ],
      },
      {
        key: 'chase_sapphire',
        name: 'Sapphire Reserve',
        officialName: 'Chase Sapphire Reserve Visa',
        mask: '8812',
        type: 'CREDIT_CARD',
        subtype: 'credit card',
        currentBalance: 7284.55,
        creditLimit: 25000,
        apr: 0.2249,
        minimumPayment: 218,
        dueInDays: 12,
        statementBalance: 6910.22,
        recurring: [
          {
            merchant: 'Netflix',
            rawName: 'NETFLIX.COM',
            amount: -22.99,
            cadence: 'MONTHLY',
            dayOfMonth: 6,
          },
          {
            merchant: 'Spotify',
            rawName: 'SPOTIFY USA',
            amount: -11.99,
            cadence: 'MONTHLY',
            dayOfMonth: 11,
          },
          {
            merchant: 'Equinox',
            rawName: 'EQUINOX AUSTIN',
            amount: -215,
            cadence: 'MONTHLY',
            dayOfMonth: 3,
          },
        ],
        discretionary: [
          { merchant: 'Uber', rawName: 'UBER *TRIP', min: 12, max: 64, perMonth: 6 },
          { merchant: 'Whole Foods', min: 40, max: 165, perMonth: 3 },
          { merchant: 'Delta Air Lines', rawName: 'DELTA AIR 0062', min: 180, max: 720, perMonth: 0.5 },
          { merchant: 'Uchi', rawName: 'UCHI AUSTIN', min: 85, max: 320, perMonth: 2 },
        ],
      },
    ],
  },
  {
    id: 'ins_bofa',
    providerInstitutionId: 'ins_bofa',
    name: 'Bank of America',
    primaryColor: '#E31837',
    website: 'https://bankofamerica.com',
    accounts: [
      {
        key: 'bofa_biz_checking',
        name: 'Business Advantage Checking',
        officialName: 'Bank of America Business Advantage Checking',
        mask: '2210',
        type: 'CHECKING',
        subtype: 'checking',
        currentBalance: 64218.9,
        availableBalance: 63918.9,
        recurring: [
          {
            merchant: 'Ridgeline Partners',
            rawName: 'ACH CREDIT RIDGELINE PARTNERS INV',
            amount: 18500,
            cadence: 'MONTHLY',
            dayOfMonth: 5,
            jitter: 0.12,
          },
          {
            merchant: 'Harbor Point Group',
            rawName: 'ACH CREDIT HARBOR POINT GRP',
            amount: 9750,
            cadence: 'MONTHLY',
            dayOfMonth: 20,
            jitter: 0.18,
          },
          {
            merchant: 'Gusto Payroll',
            rawName: 'GUSTO PAY ACH DEBIT',
            amount: -11420,
            cadence: 'SEMIMONTHLY',
            jitter: 0.04,
          },
          {
            merchant: 'Regus Office',
            rawName: 'REGUS OFFICE LEASE',
            amount: -2150,
            cadence: 'MONTHLY',
            dayOfMonth: 1,
          },
          {
            merchant: 'Hartford Business Insurance',
            rawName: 'HARTFORD BUS INS PMT',
            amount: -412,
            cadence: 'MONTHLY',
            dayOfMonth: 10,
          },
        ],
        discretionary: [
          { merchant: 'Staples', min: 40, max: 260, perMonth: 1.5 },
          { merchant: 'Delta Air Lines', rawName: 'DELTA AIR 0062', min: 240, max: 890, perMonth: 1 },
        ],
      },
      {
        key: 'bofa_biz_savings',
        name: 'Business Savings',
        officialName: 'Bank of America Business Savings',
        mask: '2211',
        type: 'SAVINGS',
        subtype: 'savings',
        currentBalance: 125000,
        recurring: [
          {
            merchant: 'Interest Payment',
            rawName: 'INTEREST PAID',
            amount: 402.18,
            cadence: 'MONTHLY',
            dayOfMonth: 28,
            jitter: 0.06,
          },
        ],
      },
    ],
  },
  {
    id: 'ins_amex',
    providerInstitutionId: 'ins_amex',
    name: 'American Express',
    primaryColor: '#006FCF',
    website: 'https://americanexpress.com',
    accounts: [
      {
        key: 'amex_biz_platinum',
        name: 'Business Platinum',
        officialName: 'American Express Business Platinum Card',
        mask: '1005',
        type: 'CREDIT_CARD',
        subtype: 'credit card',
        currentBalance: 14920.37,
        creditLimit: 40000,
        apr: 0.1999,
        minimumPayment: 448,
        dueInDays: 5,
        statementBalance: 14210.05,
        recurring: [
          {
            merchant: 'Adobe',
            rawName: 'ADOBE CREATIVE CLOUD',
            amount: -59.99,
            cadence: 'MONTHLY',
            dayOfMonth: 4,
          },
          {
            merchant: 'Amazon Web Services',
            rawName: 'AWS AMAZON WEB SERVICES',
            amount: -1284.4,
            cadence: 'MONTHLY',
            dayOfMonth: 3,
            jitter: 0.25,
          },
          {
            merchant: 'Slack',
            rawName: 'SLACK T04HR9',
            amount: -187.5,
            cadence: 'MONTHLY',
            dayOfMonth: 9,
          },
          {
            merchant: 'Google Workspace',
            rawName: 'GOOGLE *GSUITE_',
            amount: -216,
            cadence: 'MONTHLY',
            dayOfMonth: 15,
          },
          {
            merchant: 'QuickBooks',
            rawName: 'INTUIT *QUICKBOOKS',
            amount: -90,
            cadence: 'MONTHLY',
            dayOfMonth: 21,
          },
        ],
        discretionary: [
          { merchant: 'LinkedIn Ads', rawName: 'LINKEDIN ADS', min: 300, max: 1800, perMonth: 1 },
          { merchant: 'Marriott', rawName: 'MARRIOTT HOTELS', min: 220, max: 640, perMonth: 1 },
          { merchant: 'Doordash', rawName: 'DOORDASH*OFFICE', min: 60, max: 240, perMonth: 2 },
        ],
      },
    ],
  },
  {
    id: 'ins_wells',
    providerInstitutionId: 'ins_wells',
    name: 'Wells Fargo',
    primaryColor: '#D71E28',
    website: 'https://wellsfargo.com',
    accounts: [
      {
        key: 'wells_mortgage',
        name: 'Home Mortgage',
        officialName: 'Wells Fargo Home Mortgage',
        mask: '7788',
        type: 'MORTGAGE',
        subtype: 'mortgage',
        currentBalance: 412885.44,
        apr: 0.0325,
        minimumPayment: 2847.32,
        dueInDays: 9,
        originalPrincipal: 520000,
        maturityMonths: 294,
      },
      {
        key: 'wells_auto',
        name: 'Auto Loan',
        officialName: 'Wells Fargo Auto Loan',
        mask: '3391',
        type: 'AUTO_LOAN',
        subtype: 'auto',
        currentBalance: 28410.9,
        apr: 0.0589,
        minimumPayment: 684.22,
        dueInDays: 16,
        originalPrincipal: 52000,
        maturityMonths: 41,
      },
    ],
  },
  {
    id: 'ins_ally',
    providerInstitutionId: 'ins_ally',
    name: 'Ally Bank',
    primaryColor: '#6B2C91',
    website: 'https://ally.com',
    accounts: [
      {
        key: 'ally_savings',
        name: 'Online Savings',
        officialName: 'Ally Online Savings Account',
        mask: '5540',
        type: 'SAVINGS',
        subtype: 'savings',
        currentBalance: 52840.16,
        recurring: [
          {
            merchant: 'Transfer from Chase',
            rawName: 'TRANSFER FROM CHASE CHECKING',
            amount: 1500,
            cadence: 'MONTHLY',
            dayOfMonth: 2,
          },
          {
            merchant: 'Interest Payment',
            rawName: 'INTEREST PAID',
            amount: 186.4,
            cadence: 'MONTHLY',
            dayOfMonth: 30,
            jitter: 0.05,
          },
        ],
      },
    ],
  },
  {
    id: 'ins_fidelity',
    providerInstitutionId: 'ins_fidelity',
    name: 'Fidelity',
    primaryColor: '#3A8036',
    website: 'https://fidelity.com',
    accounts: [
      {
        key: 'fidelity_brokerage',
        name: 'Individual Brokerage',
        officialName: 'Fidelity Individual Brokerage Account',
        mask: '9001',
        type: 'INVESTMENT',
        subtype: 'brokerage',
        currentBalance: 214680.32,
        holdings: [
          { name: 'Vanguard Total Stock Market ETF', ticker: 'VTI', quantity: 420, price: 288.4, costBasis: 92400 },
          { name: 'Vanguard Total Intl Stock ETF', ticker: 'VXUS', quantity: 610, price: 64.15, costBasis: 34800 },
          { name: 'iShares Core U.S. Aggregate Bond', ticker: 'AGG', quantity: 380, price: 98.22, costBasis: 39100 },
        ],
      },
      {
        key: 'fidelity_401k',
        name: 'Workplace 401(k)',
        officialName: 'Fidelity Workplace Retirement 401(k)',
        mask: '9002',
        type: 'RETIREMENT',
        subtype: '401k',
        currentBalance: 386410.77,
        holdings: [
          { name: 'Fidelity 500 Index Fund', ticker: 'FXAIX', quantity: 1420, price: 196.4, costBasis: 178000 },
          { name: 'Fidelity Freedom 2045', ticker: 'FFFGX', quantity: 4200, price: 26.18, costBasis: 88000 },
        ],
      },
    ],
  },
]

export function findInstitution(id: string): InstitutionTemplate | undefined {
  return DEMO_INSTITUTIONS.find((institution) => institution.id === id)
}
