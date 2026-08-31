/**
 * Consistency check over the seeded workspace.
 *
 * Recomputes the headline figures from the same pure functions the dashboard
 * uses, and asserts the invariants that would otherwise only be visible by
 * reading numbers off a page: that combined net worth is the sum of the two
 * ledgers, that no row's denormalized ledger disagrees with its entity, and
 * that transfers, recurrence detection, and bill matching produced sane output.
 *
 *   npm run verify
 */

import { prisma } from '../lib/db'
import { computeNetWorth, computeCashByLedger } from '../lib/finance/net-worth'
import { summarizeDebt } from '../lib/finance/debt'
import { formatMoney, formatPercent } from '../lib/finance/money'
import { loadFinancialContext } from '../lib/services/dashboard'
import { parseFilters } from '../lib/validation/filters'
import { summarizeBillPay, bucketUpcoming } from '../lib/finance/bills'
import { computeIncomeExpense } from '../lib/finance/cash-flow'

let failures = 0

function check(label: string, passed: boolean): void {
  if (!passed) failures += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}`)
}

async function main(): Promise<void> {
  // Target the seeded demo workspace by name. `findFirst` with no ordering would
  // pick an arbitrary one, and the end-to-end tests create additional throwaway
  // workspaces — which is how this script started reporting a net worth of zero.
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: 'demo@example.com' },
    include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
  })
  const membership = user.memberships[0]
  if (!membership) throw new Error('The demo user has no workspace. Run: npm run db:seed')

  const scope = { workspaceId: membership.workspaceId, userId: user.id, role: 'OWNER' as const }
  const context = await loadFinancialContext(scope, parseFilters({ period: 'this-month' }))

  console.log('\n=== TOTAL FINANCIAL POSITION ===')
  const netWorth = computeNetWorth(context.accounts)
  for (const [label, position] of [
    ['Personal', netWorth.personal],
    ['Business', netWorth.business],
    ['Combined', netWorth.combined],
  ] as const) {
    console.log(
      `  ${label.padEnd(9)} assets ${formatMoney(position.assets).padStart(14)}  ` +
        `liabilities ${formatMoney(position.liabilities).padStart(14)}  ` +
        `net ${formatMoney(position.netWorth).padStart(14)}`,
    )
  }

  console.log('\n=== INVARIANTS ===')
  check(
    'combined net worth equals personal + business',
    netWorth.personal.netWorth.plus(netWorth.business.netWorth).equals(netWorth.combined.netWorth),
  )
  check(
    'combined assets equal personal + business',
    netWorth.personal.assets.plus(netWorth.business.assets).equals(netWorth.combined.assets),
  )

  const [txMismatch] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Transaction" t
    JOIN "Entity" e ON e.id = t."entityId" WHERE t.ledger <> e.ledger`
  check('every transaction ledger matches its entity', Number(txMismatch?.count ?? 0) === 0)

  const [accountMismatch] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Account" a
    JOIN "Entity" e ON e.id = a."entityId" WHERE a.ledger <> e.ledger`
  check('every account ledger matches its entity', Number(accountMismatch?.count ?? 0) === 0)

  const [billMismatch] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Bill" b
    JOIN "Entity" e ON e.id = b."entityId" WHERE b.ledger <> e.ledger`
  check('every bill ledger matches its entity', Number(billMismatch?.count ?? 0) === 0)

  const orphanTokens = await prisma.providerItem.count({
    where: { OR: [{ accessTokenCiphertext: '' }, { accessTokenTag: '' }] },
  })
  check('no provider item stores an empty token envelope', orphanTokens === 0)

  const plaintextTokens = await prisma.providerItem.count({
    where: { accessTokenCiphertext: { startsWith: 'demo-access-' } },
  })
  check('no provider access token is stored in plaintext', plaintextTokens === 0)

  console.log('\n=== CASH POSITION ===')
  const cash = computeCashByLedger(context.accounts)
  console.log(
    `  personal ${formatMoney(cash.personal.total)}   business ${formatMoney(
      cash.business.total,
    )}   total ${formatMoney(cash.total)}`,
  )

  console.log('\n=== DEBT ===')
  const debt = summarizeDebt(context.accounts)
  console.log(
    `  total ${formatMoney(debt.totalDebt)}   monthly payments ${formatMoney(
      debt.totalMinimumPayments,
    )}   weighted APR ${formatPercent(debt.weightedAverageApr, 2)}   utilization ${formatPercent(
      debt.creditUtilization,
      1,
    )}`,
  )
  for (const account of debt.accounts) {
    console.log(
      `    ${account.institutionName} ${account.name}`.padEnd(46) +
        formatMoney(account.currentBalance).padStart(14) +
        '  ' +
        (account.apr ? formatPercent(account.apr, 2) : '—'),
    )
  }

  console.log('\n=== THIS MONTH ===')
  const flow = computeIncomeExpense(context.transactions)
  console.log(
    `  income ${formatMoney(flow.income)}   expenses ${formatMoney(flow.expenses)}   net ${formatMoney(flow.net)}`,
  )

  console.log('\n=== BILLS ===')
  const billPay = summarizeBillPay(context.occurrences, new Date())
  const buckets = bucketUpcoming(context.occurrences, new Date())
  console.log(
    `  due this month ${billPay.billsDueThisMonth} (${formatMoney(billPay.amountDueThisMonth)})   ` +
      `paid ${billPay.paidCount} (${formatMoney(billPay.paidThisMonth)})   ` +
      `outstanding ${billPay.outstandingCount} (${formatMoney(billPay.outstanding)})`,
  )
  console.log(
    `  next 7 days ${formatMoney(billPay.dueNextSevenDays)}   next 30 days ${formatMoney(
      billPay.dueNextThirtyDays,
    )}   autopay ${billPay.autopayCount}   manual ${billPay.manualCount}   overdue ${billPay.overdueCount}`,
  )
  console.log(
    `  windows: 3 days ${buckets.dueInThreeDays.length}   this week ${buckets.dueThisWeek.length}   this month ${buckets.dueThisMonth.length}`,
  )

  console.log('\n=== RECURRING DETECTION ===')
  const series = await prisma.recurringSeries.findMany({ orderBy: { confidence: 'desc' } })
  console.log(`  ${series.length} series detected`)
  for (const item of series.slice(0, 14)) {
    console.log(
      `    ${item.status.padEnd(10)}${item.cadence.padEnd(13)}conf ${item.confidence
        .toFixed(2)
        .padEnd(6)}${formatMoney(item.averageAmount).padStart(12)}  ${item.isIncome ? '(income) ' : ''}${item.merchantName}`,
    )
  }
  check('recurrence detector found the known monthly bills', series.length >= 15)

  const transfers = await prisma.transaction.count({ where: { isTransfer: true } })
  console.log(`\n  ${transfers} transactions paired as internal transfers`)

  const uncategorized = await prisma.transaction.count({
    where: { OR: [{ categoryId: null }, { category: { name: 'Uncategorized' } }] },
  })
  const totalTransactions = await prisma.transaction.count()
  const uncategorizedShare = uncategorized / totalTransactions
  console.log(
    `  ${uncategorized} of ${totalTransactions} transactions uncategorized (${(uncategorizedShare * 100).toFixed(1)}%)`,
  )
  check('automatic categorization covers at least 90% of transactions', uncategorizedShare <= 0.1)

  console.log('\n=== PAYMENTS ===')
  for (const payment of await prisma.payment.findMany()) {
    console.log(
      `  ${payment.status.padEnd(13)}${formatMoney(payment.amount).padStart(12)}  ${payment.payeeName}`,
    )
    console.log(`      ${payment.confirmationSentence}`)
  }
  const completedWithoutProvider = await prisma.payment.count({
    where: { status: 'COMPLETED', providerPaymentId: null },
  })
  check('no payment is COMPLETED without a provider confirmation', completedWithoutProvider === 0)

  console.log('\n=== INSIGHTS ===')
  for (const insight of await prisma.insight.findMany({ orderBy: { severity: 'asc' } })) {
    console.log(`  ${insight.severity.padEnd(9)} ${insight.title}`)
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
  if (failures > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
