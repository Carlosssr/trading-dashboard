import 'server-only'
import { addDays, addMonths, startOfDay, startOfMonth, subDays } from 'date-fns'
import type { Cadence, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { normalizeMerchant, nextOccurrence } from '@/lib/finance/recurrence'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { assertAllOwned } from './ownership'

/**
 * Bills and their dated occurrences.
 *
 * The distinction the brief insists on lives here: a `Bill` is the user's
 * intent to pay something on a schedule, a `BillOccurrence` is one dated
 * instance of it, and an occurrence is marked PAID only from evidence — a
 * matched transaction, a provider-confirmed payment, or an explicit action by a
 * person. Scheduling a payment does not mark anything paid.
 */

/** How far ahead occurrences are materialized. */
const HORIZON_MONTHS = 4

export type CreateBillInput = {
  scope: WorkspaceScope
  entityId: string
  name: string
  payeeName: string
  expectedAmount: string
  cadence: Cadence
  dueDayOfMonth?: number | null
  nextDueAt?: Date | null
  categoryId?: string | null
  targetAccountId?: string | null
  fundingAccountId?: string | null
  autopay?: boolean
  amountType?: 'FIXED' | 'VARIABLE'
  notes?: string | null
  recurringSeriesId?: string | null
  context?: RequestContext
}

export async function createBill(input: CreateBillInput) {
  const entity = await prisma.entity.findFirst({
    where: { id: input.entityId, workspaceId: input.scope.workspaceId },
  })
  if (!entity) throw new Error('Entity not found in this workspace')

  // The remaining ids come straight from the client, and nothing at the database
  // level stops one workspace referencing another's rows.
  await assertAllOwned(input.scope.workspaceId, {
    accountIds: [input.fundingAccountId, input.targetAccountId],
    categoryIds: [input.categoryId],
  })

  const nextDueAt = input.nextDueAt ?? inferNextDue(input.dueDayOfMonth ?? null, new Date())

  const bill = await prisma.bill.create({
    data: {
      workspaceId: input.scope.workspaceId,
      entityId: entity.id,
      // Copied from the entity so bill queries filter one indexed column.
      ledger: entity.ledger,
      name: input.name.trim(),
      payeeName: input.payeeName.trim(),
      expectedAmount: input.expectedAmount,
      cadence: input.cadence,
      dueDayOfMonth: input.dueDayOfMonth ?? null,
      nextDueAt,
      categoryId: input.categoryId ?? null,
      targetAccountId: input.targetAccountId ?? null,
      fundingAccountId: input.fundingAccountId ?? null,
      autopay: input.autopay ?? false,
      amountType: input.amountType ?? 'FIXED',
      notes: input.notes ?? null,
      recurringSeriesId: input.recurringSeriesId ?? null,
    },
  })

  await generateOccurrences(bill.id)

  await recordAuditSafe({
    action: AUDIT_ACTIONS.billCreated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'bill',
    resourceId: bill.id,
    metadata: { name: bill.name, amount: bill.expectedAmount.toFixed(2), cadence: bill.cadence },
    ...(input.context ? { context: input.context } : {}),
  })

  return bill
}

function inferNextDue(dueDayOfMonth: number | null, now: Date): Date {
  if (dueDayOfMonth === null) return addDays(startOfDay(now), 30)

  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const candidate = new Date(
    thisMonth.getFullYear(),
    thisMonth.getMonth(),
    Math.min(dueDayOfMonth, daysInMonth),
  )

  return candidate >= startOfDay(now) ? candidate : addMonths(candidate, 1)
}

/**
 * Materializes occurrences from the bill's next due date out to the horizon.
 * Idempotent — the (billId, dueAt) uniqueness means re-running adds only what is
 * missing, and it never disturbs an occurrence already marked paid.
 */
export async function generateOccurrences(billId: string): Promise<number> {
  const bill = await prisma.bill.findUnique({ where: { id: billId } })
  if (!bill || bill.status !== 'ACTIVE') return 0

  const horizon = addMonths(new Date(), HORIZON_MONTHS)
  let cursor = bill.nextDueAt ?? inferNextDue(bill.dueDayOfMonth, new Date())
  let created = 0

  // Start from the beginning of the current month so the calendar shows what
  // was already due earlier this month, not just what is still ahead.
  const floor = startOfMonth(new Date())
  while (cursor > floor) {
    const previous = previousOccurrence(cursor, bill.cadence)
    if (!previous || previous < floor) break
    cursor = previous
  }

  while (cursor <= horizon) {
    const existing = await prisma.billOccurrence.findUnique({
      where: { billId_dueAt: { billId: bill.id, dueAt: startOfDay(cursor) } },
      select: { id: true },
    })

    if (!existing) {
      await prisma.billOccurrence.create({
        data: {
          billId: bill.id,
          dueAt: startOfDay(cursor),
          amountDue: bill.expectedAmount,
        },
      })
      created += 1
    }

    const next = nextOccurrence(cursor, bill.cadence, bill.dueDayOfMonth)
    if (!next || next <= cursor) break
    cursor = next
  }

  return created
}

function previousOccurrence(from: Date, cadence: Cadence): Date | null {
  switch (cadence) {
    case 'WEEKLY':
      return subDays(from, 7)
    case 'BIWEEKLY':
      return subDays(from, 14)
    case 'SEMIMONTHLY':
      return subDays(from, 15)
    case 'MONTHLY':
      return addMonths(from, -1)
    case 'QUARTERLY':
      return addMonths(from, -3)
    case 'SEMIANNUAL':
      return addMonths(from, -6)
    case 'ANNUAL':
      return addMonths(from, -12)
    case 'IRREGULAR':
      return null
  }
}

/** Refreshes occurrences for every active bill. Called after sync. */
export async function generateAllOccurrences(workspaceId: string): Promise<number> {
  const bills = await prisma.bill.findMany({
    where: { workspaceId, status: 'ACTIVE' },
    select: { id: true },
  })

  let created = 0
  for (const bill of bills) {
    created += await generateOccurrences(bill.id)
  }
  return created
}

/**
 * Amount tolerance when matching a transaction to an expected bill amount.
 * A bill marked VARIABLE gets a wider band — a metered utility or a usage-based
 * cloud invoice legitimately swings month to month, and holding it to a fixed
 * bill's tolerance would leave paid bills showing as overdue.
 */
const AMOUNT_TOLERANCE_RATIO = 0.2
const VARIABLE_AMOUNT_TOLERANCE_RATIO = 0.45
const AMOUNT_TOLERANCE_FLOOR = 25
const DATE_WINDOW_DAYS = 6

/**
 * Matches posted transactions to open occurrences. This is the *only*
 * automatic path to PAID, and it requires a real transaction to point at.
 */
export async function matchBillOccurrences(workspaceId: string): Promise<number> {
  await generateAllOccurrences(workspaceId)

  const open = await prisma.billOccurrence.findMany({
    where: {
      bill: { workspaceId, status: 'ACTIVE' },
      status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] },
      dueAt: { gte: subDays(new Date(), 90), lte: addDays(new Date(), 30) },
    },
    include: {
      bill: {
        select: {
          id: true,
          payeeName: true,
          expectedAmount: true,
          amountType: true,
          fundingAccountId: true,
          workspaceId: true,
        },
      },
    },
  })

  let matched = 0

  for (const occurrence of open) {
    const expected = occurrence.amountDue.abs()
    const ratio =
      occurrence.bill.amountType === 'VARIABLE'
        ? VARIABLE_AMOUNT_TOLERANCE_RATIO
        : AMOUNT_TOLERANCE_RATIO
    const tolerance = Math.max(expected.times(ratio).toNumber(), AMOUNT_TOLERANCE_FLOOR)
    const payeeKey = normalizeMerchant(occurrence.bill.payeeName)
    if (payeeKey.length < 3) continue

    const candidates = await prisma.transaction.findMany({
      where: {
        workspaceId,
        pending: false,
        postedAt: {
          gte: subDays(occurrence.dueAt, DATE_WINDOW_DAYS),
          lte: addDays(occurrence.dueAt, DATE_WINDOW_DAYS),
        },
        // Outflows only: a bill is money leaving.
        amount: { lt: 0 },
        ...(occurrence.bill.fundingAccountId
          ? { accountId: occurrence.bill.fundingAccountId }
          : {}),
      },
      select: { id: true, amount: true, merchantName: true, rawName: true },
      take: 200,
    })

    const match = candidates.find((candidate) => {
      const candidateKey = normalizeMerchant(candidate.merchantName ?? candidate.rawName)
      const nameMatches = candidateKey.includes(payeeKey) || payeeKey.includes(candidateKey)
      if (!nameMatches) return false

      return candidate.amount.abs().minus(expected).abs().toNumber() <= tolerance
    })

    if (!match) continue

    await prisma.billOccurrence.update({
      where: { id: occurrence.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidAmount: match.amount.abs(),
        paidSource: 'transaction-match',
        matchedTransactionId: match.id,
      },
    })
    matched += 1
  }

  await refreshOccurrenceStatuses(workspaceId)
  return matched
}

/** Moves unpaid occurrences into DUE or OVERDUE as their dates pass. */
export async function refreshOccurrenceStatuses(workspaceId: string): Promise<void> {
  const today = startOfDay(new Date())

  await prisma.billOccurrence.updateMany({
    where: {
      bill: { workspaceId },
      status: { in: ['SCHEDULED', 'DUE'] },
      dueAt: { lt: today },
    },
    data: { status: 'OVERDUE' },
  })

  await prisma.billOccurrence.updateMany({
    where: {
      bill: { workspaceId },
      status: 'SCHEDULED',
      dueAt: { gte: today, lte: addDays(today, 7) },
    },
    data: { status: 'DUE' },
  })
}

export async function listBills(scope: WorkspaceScope, filter?: { ledger?: 'PERSONAL' | 'BUSINESS'; entityId?: string }) {
  return prisma.bill.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filter?.ledger ? { ledger: filter.ledger } : {}),
      ...(filter?.entityId ? { entityId: filter.entityId } : {}),
    },
    include: {
      entity: { select: { id: true, name: true, ledger: true, color: true } },
      category: { select: { id: true, name: true } },
      fundingAccount: { select: { id: true, name: true, mask: true, institutionName: true } },
      targetAccount: { select: { id: true, name: true, mask: true } },
    },
    orderBy: [{ status: 'asc' }, { nextDueAt: 'asc' }],
  })
}

export async function listOccurrences(
  scope: WorkspaceScope,
  range: { start: Date; end: Date },
  filter?: { ledger?: 'PERSONAL' | 'BUSINESS'; entityId?: string },
) {
  return prisma.billOccurrence.findMany({
    where: {
      dueAt: { gte: range.start, lte: range.end },
      bill: {
        workspaceId: scope.workspaceId,
        ...(filter?.ledger ? { ledger: filter.ledger } : {}),
        ...(filter?.entityId ? { entityId: filter.entityId } : {}),
      },
    },
    include: {
      bill: {
        include: {
          entity: { select: { id: true, name: true, ledger: true, color: true } },
          category: { select: { id: true, name: true } },
          fundingAccount: { select: { id: true, name: true, mask: true } },
        },
      },
    },
    orderBy: { dueAt: 'asc' },
  })
}

/**
 * Manual "mark paid". Records who did it and when, and explicitly does not
 * create a Payment — tracking that a bill was paid elsewhere is not the same as
 * this application having moved money.
 */
export async function markOccurrencePaid(input: {
  scope: WorkspaceScope
  occurrenceId: string
  paidAmount?: string
  context?: RequestContext
}) {
  const occurrence = await prisma.billOccurrence.findFirst({
    where: { id: input.occurrenceId, bill: { workspaceId: input.scope.workspaceId } },
    include: { bill: { select: { id: true, name: true } } },
  })
  if (!occurrence) throw new Error('Bill occurrence not found')

  const updated = await prisma.billOccurrence.update({
    where: { id: occurrence.id },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      paidAmount: input.paidAmount ?? occurrence.amountDue,
      paidSource: 'manual',
      markedByUserId: input.scope.userId,
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.billMarkedPaid,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'bill_occurrence',
    resourceId: occurrence.id,
    metadata: {
      bill: occurrence.bill.name,
      amount: (input.paidAmount ?? occurrence.amountDue).toString(),
      source: 'manual',
    },
    ...(input.context ? { context: input.context } : {}),
  })

  return updated
}

/** Turns a confirmed detection proposal into a real bill. */
export async function promoteSeriesToBill(input: {
  scope: WorkspaceScope
  seriesId: string
  fundingAccountId?: string | null
  autopay?: boolean
  context?: RequestContext
}) {
  const series = await prisma.recurringSeries.findFirst({
    where: { id: input.seriesId, workspaceId: input.scope.workspaceId },
    include: { entity: true },
  })
  if (!series) throw new Error('Recurring series not found')

  const existing = await prisma.bill.findFirst({
    where: { workspaceId: input.scope.workspaceId, recurringSeriesId: series.id },
  })
  if (existing) return existing

  await assertAllOwned(input.scope.workspaceId, { accountIds: [input.fundingAccountId] })

  const bill = await createBill({
    scope: input.scope,
    entityId: series.entityId,
    name: series.merchantName,
    payeeName: series.merchantName,
    expectedAmount: series.averageAmount.abs().toFixed(2),
    cadence: series.cadence,
    dueDayOfMonth: series.dayOfMonth,
    nextDueAt: series.nextExpectedAt,
    categoryId: series.categoryId,
    fundingAccountId: input.fundingAccountId ?? series.accountId,
    autopay: input.autopay ?? false,
    amountType: series.minAmount.equals(series.maxAmount) ? 'FIXED' : 'VARIABLE',
    recurringSeriesId: series.id,
    ...(input.context ? { context: input.context } : {}),
  })

  await prisma.recurringSeries.update({
    where: { id: series.id },
    data: { status: 'CONFIRMED' },
  })

  return bill
}

export async function updateBill(input: {
  scope: WorkspaceScope
  billId: string
  data: Prisma.BillUpdateInput
  context?: RequestContext
}) {
  const bill = await prisma.bill.findFirst({
    where: { id: input.billId, workspaceId: input.scope.workspaceId },
  })
  if (!bill) throw new Error('Bill not found')

  const updated = await prisma.bill.update({ where: { id: bill.id }, data: input.data })
  await generateOccurrences(updated.id)

  await recordAuditSafe({
    action: AUDIT_ACTIONS.billUpdated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'bill',
    resourceId: bill.id,
    ...(input.context ? { context: input.context } : {}),
  })

  return updated
}
