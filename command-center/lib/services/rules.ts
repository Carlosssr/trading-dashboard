import 'server-only'
import type { Ledger, MatchType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { assertAllOwned } from './ownership'

/**
 * Merchant rules.
 *
 * One mechanism serves both features the brief describes: "apply this category
 * to future transactions from this merchant" and the Bill Rules block
 * (State Farm → Insurance → Personal → Monthly → Personal Checking). A rule can
 * set any subset of those targets.
 */

export type CreateRuleInput = {
  scope: WorkspaceScope
  matchType?: MatchType
  pattern: string
  categoryId?: string | null
  entityId?: string | null
  ledger?: Ledger | null
  cadence?: Prisma.MerchantRuleCreateInput['cadence']
  fundingAccountId?: string | null
  autoCreateBill?: boolean
  priority?: number
  context?: RequestContext
}

export async function createRule(input: CreateRuleInput) {
  await assertAllOwned(input.scope.workspaceId, {
    accountIds: [input.fundingAccountId],
    categoryIds: [input.categoryId],
    entityIds: [input.entityId],
  })

  const rule = await prisma.merchantRule.create({
    data: {
      workspaceId: input.scope.workspaceId,
      matchType: input.matchType ?? 'MERCHANT_CONTAINS',
      pattern: input.pattern.trim().toLowerCase(),
      categoryId: input.categoryId ?? null,
      entityId: input.entityId ?? null,
      ledger: input.ledger ?? null,
      cadence: input.cadence ?? null,
      fundingAccountId: input.fundingAccountId ?? null,
      autoCreateBill: input.autoCreateBill ?? false,
      priority: input.priority ?? 100,
      createdByUserId: input.scope.userId,
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.ruleCreated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'merchant_rule',
    resourceId: rule.id,
    metadata: { pattern: rule.pattern, matchType: rule.matchType },
    ...(input.context ? { context: input.context } : {}),
  })

  return rule
}

export async function listRules(scope: WorkspaceScope) {
  return prisma.merchantRule.findMany({
    where: { workspaceId: scope.workspaceId },
    include: {
      category: { select: { id: true, name: true } },
      fundingAccount: { select: { id: true, name: true, mask: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function deleteRule(scope: WorkspaceScope, ruleId: string): Promise<void> {
  await prisma.merchantRule.deleteMany({ where: { id: ruleId, workspaceId: scope.workspaceId } })
}

function buildWhere(
  workspaceId: string,
  rule: { matchType: MatchType; pattern: string },
  onlyUnreviewed: boolean,
): Prisma.TransactionWhereInput {
  const base: Prisma.TransactionWhereInput = { workspaceId }

  // The user's own corrections outrank rules on a backfill, so by default only
  // transactions that still hold an automatic category are touched.
  if (onlyUnreviewed) {
    base.OR = [{ categoryId: null }, { category: { name: 'Uncategorized' } }]
  }

  switch (rule.matchType) {
    case 'MERCHANT_EXACT':
      return { ...base, merchantName: { equals: rule.pattern, mode: 'insensitive' } }
    case 'MERCHANT_CONTAINS':
      return { ...base, merchantName: { contains: rule.pattern, mode: 'insensitive' } }
    case 'DESCRIPTION_CONTAINS':
    case 'REGEX':
      // Regex is matched in the database as a substring first, then refined in
      // memory — Postgres regex support varies and a bad pattern should not be
      // able to hang a sync.
      return { ...base, rawName: { contains: rule.pattern.replace(/[^\w\s]/g, ''), mode: 'insensitive' } }
  }
}

/**
 * Applies every active rule to matching transactions. Runs as the second stage
 * of post-sync processing, before recurrence detection, so detected series
 * inherit the categories the rules assigned.
 */
export async function applyMerchantRules(workspaceId: string, options?: { includeReviewed?: boolean }): Promise<number> {
  const rules = await prisma.merchantRule.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { priority: 'asc' },
  })

  let applied = 0

  for (const rule of rules) {
    const data: Prisma.TransactionUncheckedUpdateManyInput = {}
    if (rule.categoryId) data.categoryId = rule.categoryId
    if (rule.entityId) data.entityId = rule.entityId
    if (rule.ledger) data.ledger = rule.ledger

    if (Object.keys(data).length === 0) continue

    // Changing the entity must move the ledger with it, or the two would
    // disagree and a business transaction would show on the personal books.
    if (rule.entityId && !rule.ledger) {
      const entity = await prisma.entity.findFirst({
        where: { id: rule.entityId, workspaceId },
        select: { ledger: true },
      })
      if (entity) data.ledger = entity.ledger
    }

    const result = await prisma.transaction.updateMany({
      where: buildWhere(workspaceId, rule, !options?.includeReviewed),
      data,
    })

    if (result.count > 0) {
      applied += result.count
      await prisma.merchantRule.update({
        where: { id: rule.id },
        data: { appliedCount: { increment: result.count }, lastAppliedAt: new Date() },
      })
    }
  }

  return applied
}

/**
 * Backfills one rule across all history, including transactions that already
 * carry a category — this is the explicit "apply to past transactions too"
 * action, so it is allowed to overwrite.
 */
export async function backfillRule(input: {
  scope: WorkspaceScope
  ruleId: string
  context?: RequestContext
}): Promise<number> {
  const rule = await prisma.merchantRule.findFirst({
    where: { id: input.ruleId, workspaceId: input.scope.workspaceId },
  })
  if (!rule) throw new Error('Rule not found')

  const data: Prisma.TransactionUncheckedUpdateManyInput = {}
  if (rule.categoryId) data.categoryId = rule.categoryId
  if (rule.entityId) data.entityId = rule.entityId
  if (rule.ledger) data.ledger = rule.ledger

  if (rule.entityId && !rule.ledger) {
    const entity = await prisma.entity.findFirst({
      where: { id: rule.entityId, workspaceId: input.scope.workspaceId },
      select: { ledger: true },
    })
    if (entity) data.ledger = entity.ledger
  }

  if (Object.keys(data).length === 0) return 0

  const result = await prisma.transaction.updateMany({
    where: buildWhere(input.scope.workspaceId, rule, false),
    data,
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.ruleApplied,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'merchant_rule',
    resourceId: rule.id,
    metadata: { affected: result.count, backfill: true },
    ...(input.context ? { context: input.context } : {}),
  })

  return result.count
}
