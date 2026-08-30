import 'server-only'
import type { CategoryGroup, Ledger } from '@prisma/client'
import { prisma } from '@/lib/db'

/**
 * The system category tree and the automatic categorizer.
 *
 * Categorization is a deterministic cascade, most specific first:
 *
 *   1. A user's MerchantRule (highest priority wins)
 *   2. The built-in keyword map below
 *   3. The provider's own category hint
 *   4. Uncategorized
 *
 * No model, no network call. The user can always see why something landed where
 * it did, and correcting it creates a rule that wins next time.
 */

type SeedCategory = {
  name: string
  group: CategoryGroup
  ledgerHint?: Ledger
  children?: string[]
}

export const SYSTEM_CATEGORIES: SeedCategory[] = [
  // Income
  { name: 'Salary & Wages', group: 'INCOME', ledgerHint: 'PERSONAL' },
  { name: 'Business Revenue', group: 'INCOME', ledgerHint: 'BUSINESS' },
  { name: 'Rental Income', group: 'INCOME' },
  { name: 'Interest & Dividends', group: 'INCOME' },
  { name: 'Refunds & Reimbursements', group: 'INCOME' },
  { name: 'Other Income', group: 'INCOME' },

  // Housing
  {
    name: 'Housing',
    group: 'EXPENSE',
    children: ['Mortgage', 'Rent', 'Property Tax', 'HOA Fees', 'Home Maintenance'],
  },
  {
    name: 'Utilities',
    group: 'EXPENSE',
    children: ['Electric & Gas', 'Water & Sewer', 'Internet', 'Phone', 'Trash'],
  },
  {
    name: 'Insurance',
    group: 'EXPENSE',
    children: ['Auto Insurance', 'Home Insurance', 'Health Insurance', 'Life Insurance'],
  },
  {
    name: 'Transportation',
    group: 'EXPENSE',
    children: ['Gas & Fuel', 'Auto Payment', 'Auto Maintenance', 'Parking & Tolls', 'Rideshare & Taxi', 'Public Transit'],
  },
  {
    name: 'Food & Dining',
    group: 'EXPENSE',
    children: ['Groceries', 'Restaurants', 'Coffee Shops', 'Food Delivery'],
  },
  {
    name: 'Health & Fitness',
    group: 'EXPENSE',
    children: ['Doctor & Medical', 'Pharmacy', 'Gym & Fitness'],
  },
  { name: 'Shopping', group: 'EXPENSE', children: ['General Merchandise', 'Clothing', 'Electronics', 'Home Goods'] },
  { name: 'Entertainment', group: 'EXPENSE', children: ['Subscriptions', 'Events & Tickets', 'Hobbies'] },
  { name: 'Travel', group: 'EXPENSE', children: ['Airfare', 'Hotels', 'Rental Cars'] },
  { name: 'Personal Care', group: 'EXPENSE' },
  { name: 'Education', group: 'EXPENSE' },
  { name: 'Charity & Gifts', group: 'EXPENSE' },
  { name: 'Fees & Charges', group: 'EXPENSE', children: ['Bank Fees', 'Interest Charges', 'Service Fees'] },
  { name: 'Taxes', group: 'EXPENSE' },

  // Business
  {
    name: 'Business Expenses',
    group: 'EXPENSE',
    ledgerHint: 'BUSINESS',
    children: [
      'Business Software',
      'Cloud & Hosting',
      'Payroll',
      'Contractors',
      'Office & Rent',
      'Business Insurance',
      'Advertising & Marketing',
      'Professional Services',
      'Business Travel',
      'Business Meals',
      'Business Supplies',
      'Merchant Fees',
    ],
  },

  // Property operations
  {
    name: 'Property Expenses',
    group: 'EXPENSE',
    children: ['Property Management', 'Repairs & Turnover', 'Landscaping', 'Property Insurance'],
  },

  // Movement between accounts
  { name: 'Transfer', group: 'TRANSFER' },
  { name: 'Credit Card Payment', group: 'DEBT_PAYMENT' },
  { name: 'Loan Payment', group: 'DEBT_PAYMENT' },

  { name: 'Uncategorized', group: 'EXPENSE' },
]

/**
 * Merchant keyword → leaf category name.
 *
 * Matched against the lowercased merchant name and raw description. Longer
 * keys are tested first so "amazon web services" beats "amazon".
 */
const KEYWORD_MAP: Record<string, string> = {
  // Business software and services
  'amazon web services': 'Cloud & Hosting',
  aws: 'Cloud & Hosting',
  'google workspace': 'Business Software',
  'google *gsuite': 'Business Software',
  adobe: 'Business Software',
  slack: 'Business Software',
  quickbooks: 'Business Software',
  intuit: 'Business Software',
  atlassian: 'Business Software',
  github: 'Business Software',
  notion: 'Business Software',
  zoom: 'Business Software',
  dropbox: 'Business Software',
  figma: 'Business Software',
  'linkedin ads': 'Advertising & Marketing',
  'google ads': 'Advertising & Marketing',
  'meta platforms': 'Advertising & Marketing',
  mailchimp: 'Advertising & Marketing',
  gusto: 'Payroll',
  'adp payroll': 'Payroll',
  rippling: 'Payroll',
  upwork: 'Contractors',
  fiverr: 'Contractors',
  regus: 'Office & Rent',
  wework: 'Office & Rent',
  staples: 'Business Supplies',
  'office depot': 'Business Supplies',
  stripe: 'Merchant Fees',
  'square inc': 'Merchant Fees',
  'hartford bus': 'Business Insurance',

  // Housing and utilities
  mortgage: 'Mortgage',
  'home mtg': 'Mortgage',
  'wf home': 'Mortgage',
  comcast: 'Internet',
  xfinity: 'Internet',
  'spectrum': 'Internet',
  'at&t': 'Phone',
  verizon: 'Phone',
  't-mobile': 'Phone',
  utilities: 'Electric & Gas',
  'city of': 'Electric & Gas',
  pge: 'Electric & Gas',
  'duke energy': 'Electric & Gas',

  // Insurance
  'state farm': 'Auto Insurance',
  geico: 'Auto Insurance',
  progressive: 'Auto Insurance',
  allstate: 'Home Insurance',
  'blue cross': 'Health Insurance',

  // Transportation
  shell: 'Gas & Fuel',
  chevron: 'Gas & Fuel',
  exxon: 'Gas & Fuel',
  'circle k': 'Gas & Fuel',
  bp: 'Gas & Fuel',
  uber: 'Rideshare & Taxi',
  lyft: 'Rideshare & Taxi',
  'auto loan': 'Auto Payment',

  // Food
  'h-e-b': 'Groceries',
  heb: 'Groceries',
  kroger: 'Groceries',
  safeway: 'Groceries',
  'trader joe': 'Groceries',
  'whole foods': 'Groceries',
  costco: 'Groceries',
  starbucks: 'Coffee Shops',
  'blue bottle': 'Coffee Shops',
  doordash: 'Food Delivery',
  grubhub: 'Food Delivery',
  'uber eats': 'Food Delivery',
  chipotle: 'Restaurants',
  uchi: 'Restaurants',

  // Subscriptions and entertainment
  netflix: 'Subscriptions',
  spotify: 'Subscriptions',
  hulu: 'Subscriptions',
  'disney plus': 'Subscriptions',
  'apple.com/bill': 'Subscriptions',
  youtube: 'Subscriptions',
  equinox: 'Gym & Fitness',
  peloton: 'Gym & Fitness',

  // Shopping and travel
  amazon: 'General Merchandise',
  'amzn mktp': 'General Merchandise',
  target: 'General Merchandise',
  walmart: 'General Merchandise',
  'best buy': 'Electronics',
  'home depot': 'Home Maintenance',
  lowes: 'Home Maintenance',
  delta: 'Airfare',
  'united airlines': 'Airfare',
  southwest: 'Airfare',
  marriott: 'Hotels',
  hilton: 'Hotels',
  airbnb: 'Hotels',

  // Income
  payroll: 'Salary & Wages',
  'direct dep': 'Salary & Wages',
  'interest paid': 'Interest & Dividends',

  // Movement
  'card payment': 'Credit Card Payment',
  'payment thank you': 'Credit Card Payment',
  'transfer to': 'Transfer',
  'transfer from': 'Transfer',
}

/** Longest keys first so specific merchants beat generic ones. */
const SORTED_KEYWORDS = Object.entries(KEYWORD_MAP).sort((a, b) => b[0].length - a[0].length)

/** Provider category hints, used only when no keyword matched. */
const PROVIDER_HINT_MAP: Record<string, string> = {
  INCOME: 'Other Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Loan Payment',
  BANK_FEES: 'Bank Fees',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Restaurants',
  GENERAL_MERCHANDISE: 'General Merchandise',
  HOME_IMPROVEMENT: 'Home Maintenance',
  MEDICAL: 'Doctor & Medical',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_SERVICES: 'Professional Services',
  GOVERNMENT_AND_NON_PROFIT: 'Taxes',
  TRANSPORTATION: 'Gas & Fuel',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Utilities',
}

export type CategoryLookup = Map<string, string>

/** Name → id, for the categorizer to resolve its answers to real rows. */
export async function loadCategoryLookup(workspaceId: string): Promise<CategoryLookup> {
  const categories = await prisma.category.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  })
  return new Map(categories.map((category) => [category.name.toLowerCase(), category.id]))
}

export type CategorizationInput = {
  merchantName: string | null
  rawName: string
  amount: number
  categoryHint?: string[] | null
}

export type CategorizationResult = {
  categoryName: string
  source: 'keyword' | 'provider-hint' | 'sign-fallback'
}

export function categorize(input: CategorizationInput): CategorizationResult {
  const haystack = `${input.merchantName ?? ''} ${input.rawName}`.toLowerCase()

  for (const [keyword, categoryName] of SORTED_KEYWORDS) {
    if (haystack.includes(keyword)) {
      return { categoryName, source: 'keyword' }
    }
  }

  for (const hint of input.categoryHint ?? []) {
    const mapped = PROVIDER_HINT_MAP[hint.toUpperCase()]
    if (mapped) return { categoryName: mapped, source: 'provider-hint' }
  }

  // Nothing matched: an inflow is income, an outflow is uncategorized spending.
  return {
    categoryName: input.amount > 0 ? 'Other Income' : 'Uncategorized',
    source: 'sign-fallback',
  }
}

export function resolveCategoryId(lookup: CategoryLookup, categoryName: string): string | null {
  return lookup.get(categoryName.toLowerCase()) ?? null
}

/**
 * Creates the system tree for a new workspace. Idempotent.
 *
 * Uses find-then-create rather than upsert because Postgres treats NULLs as
 * distinct in a unique index, so the (workspaceId, name, parentId) constraint
 * does not actually prevent duplicate top-level rows.
 */
export async function seedSystemCategories(workspaceId: string): Promise<void> {
  for (const [index, category] of SYSTEM_CATEGORIES.entries()) {
    const parent =
      (await prisma.category.findFirst({
        where: { workspaceId, name: category.name, parentId: null },
      })) ??
      (await prisma.category.create({
        data: {
          workspaceId,
          name: category.name,
          group: category.group,
          isSystem: true,
          sortOrder: index * 100,
          ...(category.ledgerHint ? { ledgerHint: category.ledgerHint } : {}),
        },
      }))

    for (const [childIndex, childName] of (category.children ?? []).entries()) {
      const existing = await prisma.category.findFirst({
        where: { workspaceId, name: childName, parentId: parent.id },
      })
      if (existing) continue

      await prisma.category.create({
        data: {
          workspaceId,
          name: childName,
          group: category.group,
          parentId: parent.id,
          isSystem: true,
          sortOrder: index * 100 + childIndex + 1,
          ...(category.ledgerHint ? { ledgerHint: category.ledgerHint } : {}),
        },
      })
    }
  }
}
