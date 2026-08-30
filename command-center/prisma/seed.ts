/**
 * Demo seed.
 *
 * This does not insert dashboard rows directly. It registers a user, links
 * institutions through the real link flow, and runs the real sync pipeline —
 * so a successful seed is also an end-to-end test of exchange, encryption,
 * account upserts, transaction delta sync, transfer pairing, categorization,
 * recurrence detection, bill matching, and insight generation.
 *
 *   npm run db:seed
 */

import { addDays, subDays, subMonths } from 'date-fns'
import { prisma } from '../lib/db'
import { hashPassword } from '../lib/auth/password'
import { seedSystemCategories, loadCategoryLookup } from '../lib/services/categories'
import { exchangeAndLink } from '../lib/services/linking'
import { syncItem } from '../lib/services/sync'
import { createEntity, setCashReserve } from '../lib/services/entities'
import { createRule, backfillRule } from '../lib/services/rules'
import { upsertProperty } from '../lib/services/properties'
import { listRecurring } from '../lib/services/recurring'
import { promoteSeriesToBill, matchBillOccurrences } from '../lib/services/bills'
import { createDraftPayment, confirmPayment, settlePayment } from '../lib/services/payments'
import { regenerateInsights } from '../lib/services/insights'
import { parseFilters } from '../lib/validation/filters'
import type { WorkspaceScope } from '../lib/auth/guards'

const DEMO_EMAIL = 'demo@example.com'
const DEMO_PASSWORD = 'DemoPassword123!'

const context = { ipAddress: '127.0.0.1', userAgent: 'seed-script' }

function log(step: string, detail = ''): void {
  process.stdout.write(`  ${step}${detail ? ` — ${detail}` : ''}\n`)
}

async function main(): Promise<void> {
  process.stdout.write('\nSeeding Financial Command Center demo data\n\n')

  // --- Clean slate -------------------------------------------------------
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    include: { memberships: true },
  })
  if (existing) {
    await prisma.workspace.deleteMany({
      where: { id: { in: existing.memberships.map((m) => m.workspaceId) } },
    })
    await prisma.user.delete({ where: { id: existing.id } })
    log('Removed previous demo workspace')
  }

  // --- User, workspace, default entity -----------------------------------
  const { hash, salt } = await hashPassword(DEMO_PASSWORD)

  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, name: 'Alex Rivera', passwordHash: hash, passwordSalt: salt },
  })

  const workspace = await prisma.workspace.create({ data: { name: 'Rivera Household & Companies' } })
  await prisma.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  })

  const scope: WorkspaceScope = { workspaceId: workspace.id, userId: user.id, role: 'OWNER' }

  const personal = await prisma.entity.create({
    data: {
      workspaceId: workspace.id,
      name: 'Personal',
      kind: 'PERSONAL',
      ledger: 'PERSONAL',
      isDefault: true,
      color: '#0f766e',
      minCashReserve: '5000',
    },
  })

  await seedSystemCategories(workspace.id)
  log('Created user, workspace, and category tree', DEMO_EMAIL)

  // --- Entities ----------------------------------------------------------
  const northgate = await createEntity({
    scope,
    name: 'Northgate Consulting LLC',
    kind: 'LLC',
    ledger: 'BUSINESS',
    color: '#1d4ed8',
    minCashReserve: '25000',
    context,
  })

  const ridgeview = await createEntity({
    scope,
    name: 'Ridgeview Media LLC',
    kind: 'LLC',
    ledger: 'BUSINESS',
    color: '#7c3aed',
    minCashReserve: '8000',
    context,
  })

  const mapleStreet = await createEntity({
    scope,
    name: 'Maple Street Rental',
    kind: 'RENTAL_PROPERTY',
    ledger: 'BUSINESS',
    color: '#b45309',
    context,
  })

  const lakeview = await createEntity({
    scope,
    name: 'Lakeview Duplex',
    kind: 'RENTAL_PROPERTY',
    ledger: 'BUSINESS',
    color: '#0891b2',
    context,
  })

  log('Created entities', 'Personal, 2 LLCs, 2 rental properties')

  // --- Link institutions and sync ----------------------------------------
  const links: { institution: string; entityId: string }[] = [
    { institution: 'ins_chase', entityId: personal.id },
    { institution: 'ins_ally', entityId: personal.id },
    { institution: 'ins_wells', entityId: personal.id },
    { institution: 'ins_fidelity', entityId: personal.id },
    { institution: 'ins_bofa', entityId: northgate.id },
    { institution: 'ins_amex', entityId: northgate.id },
    { institution: 'ins_mercury', entityId: ridgeview.id },
  ]

  for (const link of links) {
    const { itemId, institutionName } = await exchangeAndLink({
      scope,
      publicToken: `demo-public-${link.institution}`,
      entityId: link.entityId,
      context,
    })

    const result = await syncItem({ scope, itemId, entityId: link.entityId, context })

    if (result.error) {
      throw new Error(`Sync failed for ${institutionName}: ${result.error}`)
    }

    log(
      `Linked and synced ${institutionName}`,
      `${result.accountsUpserted} accounts, ${result.transactionsAdded} transactions`,
    )
  }

  // --- Merchant rules ----------------------------------------------------
  const categories = await loadCategoryLookup(workspace.id)

  const ruleSpecs = [
    { pattern: 'state farm', category: 'auto insurance', entityId: personal.id },
    { pattern: 'shell', category: 'gas & fuel', entityId: personal.id },
    { pattern: 'adobe', category: 'business software', entityId: null },
    { pattern: 'amazon web services', category: 'cloud & hosting', entityId: northgate.id },
    { pattern: 'gusto', category: 'payroll', entityId: northgate.id },
    { pattern: 'upwork', category: 'contractors', entityId: ridgeview.id },
  ]

  for (const spec of ruleSpecs) {
    const categoryId = categories.get(spec.category)
    if (!categoryId) continue

    const rule = await createRule({
      scope,
      pattern: spec.pattern,
      categoryId,
      entityId: spec.entityId,
      context,
    })
    await backfillRule({ scope, ruleId: rule.id, context })
  }
  log('Created merchant rules', `${ruleSpecs.length} rules, backfilled across history`)

  // --- Real estate -------------------------------------------------------
  const mortgageAccount = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, type: 'MORTGAGE' },
  })

  await upsertProperty({
    scope,
    entityId: personal.id,
    name: 'Primary Residence',
    addressLine1: '1420 Windsor Road',
    city: 'Austin',
    region: 'TX',
    postalCode: '78703',
    propertyType: 'PRIMARY_RESIDENCE',
    purchaseDate: subMonths(new Date(), 66),
    purchasePrice: '520000',
    estimatedValue: '685000',
    isRental: false,
    monthlyPropertyTax: '1042',
    monthlyInsurance: '212',
    mortgageAccountId: mortgageAccount?.id ?? null,
  })

  await upsertProperty({
    scope,
    entityId: mapleStreet.id,
    name: 'Maple Street Rental',
    addressLine1: '88 Maple Street',
    city: 'Round Rock',
    region: 'TX',
    postalCode: '78664',
    propertyType: 'RENTAL',
    purchaseDate: subMonths(new Date(), 40),
    purchasePrice: '289000',
    estimatedValue: '342000',
    isRental: true,
    monthlyRent: '2450',
    monthlyPropertyTax: '486',
    monthlyInsurance: '132',
    monthlyOtherExpenses: '180',
    manualMortgageBalance: '214300',
    manualMortgagePayment: '1284.55',
    manualMortgageRate: 0.0475,
  })

  await upsertProperty({
    scope,
    entityId: lakeview.id,
    name: 'Lakeview Duplex',
    addressLine1: '2201 Lakeview Drive',
    city: 'Austin',
    region: 'TX',
    postalCode: '78745',
    propertyType: 'MULTI_FAMILY',
    purchaseDate: subMonths(new Date(), 22),
    purchasePrice: '470000',
    estimatedValue: '515000',
    isRental: true,
    monthlyRent: '3900',
    monthlyPropertyTax: '742',
    monthlyInsurance: '198',
    monthlyHoa: '0',
    monthlyOtherExpenses: '340',
    manualMortgageBalance: '381240',
    manualMortgagePayment: '2410.18',
    manualMortgageRate: 0.0655,
  })

  log('Created properties', '3 properties with valuations and value accounts')

  // --- Cash reserves -----------------------------------------------------
  await setCashReserve({ scope, scopeKind: 'PERSONAL', minimumAmount: '5000' })
  await setCashReserve({ scope, scopeKind: 'BUSINESS', minimumAmount: '20000' })
  await setCashReserve({ scope, scopeKind: 'ENTITY', entityId: ridgeview.id, minimumAmount: '8000' })
  log('Set cash reserve thresholds', 'personal $5,000 · business $20,000 · Ridgeview $8,000')

  // --- Promote detected recurring series into bills -----------------------
  const detected = await listRecurring(scope, { status: 'DETECTED' })

  // Confident, clearly-a-bill merchants become bills; the rest stay as
  // proposals so the Recurring page has Add/Ignore/Edit work to show.
  const billMerchants = [
    'Wells Fargo Home Mortgage',
    'State Farm',
    'Verizon',
    'Comcast Xfinity',
    'City of Austin Utilities',
    'Netflix',
    'Spotify',
    'Equinox',
    'Adobe',
    'Amazon Web Services',
    'Slack',
    'Google Workspace',
    'QuickBooks',
    'Regus Office',
    'Hartford Business Insurance',
    'Frame.io',
  ]
  const autopayMerchants = new Set([
    'Wells Fargo Home Mortgage',
    'State Farm',
    'Netflix',
    'Spotify',
    'Adobe',
    'Amazon Web Services',
  ])

  let billsCreated = 0
  for (const series of detected) {
    if (series.isIncome) continue
    if (!billMerchants.includes(series.merchantName)) continue

    await promoteSeriesToBill({
      scope,
      seriesId: series.id,
      autopay: autopayMerchants.has(series.merchantName),
      context,
    })
    billsCreated += 1
  }

  const remaining = await listRecurring(scope, { status: 'DETECTED' })
  log('Promoted recurring series to bills', `${billsCreated} bills, ${remaining.length} proposals left`)

  // Credit card bills are tracked against the card's own statement, not a
  // detected merchant series.
  const cards = await prisma.account.findMany({
    where: { workspaceId: workspace.id, type: 'CREDIT_CARD' },
    include: { entity: true },
  })
  const checkingByEntity = new Map(
    (
      await prisma.account.findMany({
        where: { workspaceId: workspace.id, type: 'CHECKING' },
      })
    ).map((account) => [account.entityId, account.id]),
  )

  for (const card of cards) {
    await prisma.bill.create({
      data: {
        workspaceId: workspace.id,
        entityId: card.entityId,
        ledger: card.ledger,
        name: `${card.name} payment`,
        payeeName: card.institutionName,
        expectedAmount: (card.minimumPayment ?? card.currentBalance).toFixed(2),
        cadence: 'MONTHLY',
        amountType: 'VARIABLE',
        dueDayOfMonth: card.nextPaymentDueAt?.getDate() ?? 15,
        nextDueAt: card.nextPaymentDueAt,
        targetAccountId: card.id,
        fundingAccountId: checkingByEntity.get(card.entityId) ?? null,
        categoryId: (await loadCategoryLookup(workspace.id)).get('credit card payment') ?? null,
        autopay: false,
      },
    })
  }
  log('Created credit card bills', `${cards.length} cards`)

  await matchBillOccurrences(workspace.id)

  // --- Payment history ---------------------------------------------------
  const personalChecking = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, entityId: personal.id, type: 'CHECKING' },
  })
  const businessChecking = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, entityId: northgate.id, type: 'CHECKING' },
  })

  if (personalChecking && businessChecking) {
    // One completed payment, taken all the way through provider settlement so
    // the history shows a genuinely confirmed payment rather than an assumed one.
    const completed = await createDraftPayment({
      scope,
      fundingAccountId: personalChecking.id,
      payeeName: 'State Farm',
      amount: '185.00',
      scheduledFor: subDays(new Date(), 12),
      memo: 'Auto policy',
      context,
    })
    const confirmedPayment = await confirmPayment({
      scope,
      paymentId: completed.paymentId,
      token: completed.token,
      context,
    })
    if (confirmedPayment.providerPaymentId) {
      await settlePayment({
        providerPaymentId: confirmedPayment.providerPaymentId,
        status: 'COMPLETED',
      })
    }

    // One scheduled but not yet settled — it must not read as paid anywhere.
    const scheduled = await createDraftPayment({
      scope,
      fundingAccountId: businessChecking.id,
      payeeName: 'Regus Office',
      amount: '2150.00',
      scheduledFor: addDays(new Date(), 6),
      memo: 'Office lease',
      context,
    })
    await confirmPayment({ scope, paymentId: scheduled.paymentId, token: scheduled.token, context })

    log('Created payment history', '1 completed, 1 scheduled')
  }

  // --- Insights ----------------------------------------------------------
  const insightCount = await regenerateInsights(scope, parseFilters({ period: 'this-month' }))
  log('Generated insights', `${insightCount} active`)

  // --- Summary -----------------------------------------------------------
  const [accounts, transactions, bills, occurrences, properties] = await Promise.all([
    prisma.account.count({ where: { workspaceId: workspace.id } }),
    prisma.transaction.count({ where: { workspaceId: workspace.id } }),
    prisma.bill.count({ where: { workspaceId: workspace.id } }),
    prisma.billOccurrence.count({ where: { bill: { workspaceId: workspace.id } } }),
    prisma.property.count({ where: { workspaceId: workspace.id } }),
  ])

  process.stdout.write('\nSeed complete\n')
  process.stdout.write(`  ${accounts} accounts · ${transactions} transactions · ${bills} bills · `)
  process.stdout.write(`${occurrences} bill occurrences · ${properties} properties\n`)
  process.stdout.write(`\n  Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`\nSeed failed: ${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
