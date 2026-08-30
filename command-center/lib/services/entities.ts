import 'server-only'
import type { EntityKind, Ledger } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'

/**
 * Entities — the boundary that keeps personal and business books apart.
 *
 * An entity's `ledger` is immutable after creation. Flipping an LLC from
 * BUSINESS to PERSONAL would silently move every account, transaction, bill, and
 * payment it owns onto the other set of books; the correct operation is to
 * create the right entity and reassign accounts to it deliberately.
 */

export async function listEntities(scope: WorkspaceScope, options?: { includeArchived?: boolean }) {
  return prisma.entity.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(options?.includeArchived ? {} : { archivedAt: null }),
    },
    include: { _count: { select: { accounts: true, transactions: true, properties: true } } },
    orderBy: [{ ledger: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
  })
}

export async function createEntity(input: {
  scope: WorkspaceScope
  name: string
  kind: EntityKind
  ledger: Ledger
  color?: string
  minCashReserve?: string | null
  notes?: string | null
  context?: RequestContext
}) {
  const entity = await prisma.entity.create({
    data: {
      workspaceId: input.scope.workspaceId,
      name: input.name.trim(),
      kind: input.kind,
      ledger: input.ledger,
      color: input.color ?? '#64748b',
      minCashReserve: input.minCashReserve ?? null,
      notes: input.notes ?? null,
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.entityCreated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'entity',
    resourceId: entity.id,
    metadata: { name: entity.name, ledger: entity.ledger, kind: entity.kind },
    ...(input.context ? { context: input.context } : {}),
  })

  return entity
}

export async function updateEntity(input: {
  scope: WorkspaceScope
  entityId: string
  name?: string
  color?: string
  minCashReserve?: string | null
  notes?: string | null
  context?: RequestContext
}) {
  const entity = await prisma.entity.findFirst({
    where: { id: input.entityId, workspaceId: input.scope.workspaceId },
  })
  if (!entity) throw new Error('Entity not found')

  const updated = await prisma.entity.update({
    where: { id: entity.id },
    data: {
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.minCashReserve !== undefined ? { minCashReserve: input.minCashReserve } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.entityUpdated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'entity',
    resourceId: entity.id,
    ...(input.context ? { context: input.context } : {}),
  })

  return updated
}

/**
 * Moves an account to a different entity.
 *
 * The account's ledger and every one of its transactions must move with it, in
 * one database transaction — a half-applied reassignment would leave business
 * transactions sitting on the personal books.
 */
export async function reassignAccount(input: {
  scope: WorkspaceScope
  accountId: string
  entityId: string
  context?: RequestContext
}): Promise<{ transactionsMoved: number }> {
  const [account, entity] = await Promise.all([
    prisma.account.findFirst({
      where: { id: input.accountId, workspaceId: input.scope.workspaceId },
    }),
    prisma.entity.findFirst({
      where: { id: input.entityId, workspaceId: input.scope.workspaceId },
    }),
  ])

  if (!account) throw new Error('Account not found')
  if (!entity) throw new Error('Entity not found')

  const transactionsMoved = await prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: account.id },
      data: { entityId: entity.id, ledger: entity.ledger },
    })

    const moved = await tx.transaction.updateMany({
      where: { accountId: account.id },
      data: { entityId: entity.id, ledger: entity.ledger },
    })

    await tx.recurringSeries.updateMany({
      where: { accountId: account.id },
      data: { entityId: entity.id },
    })

    return moved.count
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.accountReassigned,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'account',
    resourceId: account.id,
    metadata: {
      from: { entityId: account.entityId, ledger: account.ledger },
      to: { entityId: entity.id, ledger: entity.ledger },
      transactionsMoved,
    },
    ...(input.context ? { context: input.context } : {}),
  })

  return { transactionsMoved }
}

/** Refused while accounts still reference the entity — that would orphan them. */
export async function archiveEntity(input: {
  scope: WorkspaceScope
  entityId: string
}): Promise<void> {
  const accountCount = await prisma.account.count({
    where: { entityId: input.entityId, workspaceId: input.scope.workspaceId },
  })
  if (accountCount > 0) {
    throw new Error(
      `This entity still holds ${accountCount} account${accountCount === 1 ? '' : 's'}. Reassign them first.`,
    )
  }

  await prisma.entity.updateMany({
    where: { id: input.entityId, workspaceId: input.scope.workspaceId, isDefault: false },
    data: { archivedAt: new Date() },
  })
}

export type CashReserveInput = {
  scope: WorkspaceScope
  scopeKind: 'PERSONAL' | 'BUSINESS' | 'ENTITY'
  entityId?: string | null
  minimumAmount: string
}

/**
 * Find-then-write rather than upsert: `entityId` is nullable and part of the
 * unique key, and Postgres treats NULLs as distinct, so the constraint does not
 * actually cover the ledger-wide rules where `entityId` is null.
 */
export async function setCashReserve(input: CashReserveInput) {
  const existing = await prisma.cashReserveRule.findFirst({
    where: {
      workspaceId: input.scope.workspaceId,
      scope: input.scopeKind,
      entityId: input.entityId ?? null,
    },
  })

  if (existing) {
    return prisma.cashReserveRule.update({
      where: { id: existing.id },
      data: { minimumAmount: input.minimumAmount },
    })
  }

  return prisma.cashReserveRule.create({
    data: {
      workspaceId: input.scope.workspaceId,
      scope: input.scopeKind,
      entityId: input.entityId ?? null,
      minimumAmount: input.minimumAmount,
    },
  })
}

export async function listCashReserves(scope: WorkspaceScope) {
  return prisma.cashReserveRule.findMany({
    where: { workspaceId: scope.workspaceId },
    include: { entity: { select: { id: true, name: true, ledger: true } } },
  })
}

/**
 * The reserve that applies to a funding account: the entity-specific rule if one
 * exists, otherwise the rule for its ledger, otherwise the entity's own
 * `minCashReserve`.
 */
export async function resolveReserveFor(input: {
  workspaceId: string
  entityId: string
  ledger: Ledger
}): Promise<string | null> {
  const [entityRule, ledgerRule, entity] = await Promise.all([
    prisma.cashReserveRule.findFirst({
      where: { workspaceId: input.workspaceId, scope: 'ENTITY', entityId: input.entityId },
    }),
    prisma.cashReserveRule.findFirst({
      where: { workspaceId: input.workspaceId, scope: input.ledger, entityId: null },
    }),
    prisma.entity.findUnique({ where: { id: input.entityId }, select: { minCashReserve: true } }),
  ])

  const resolved = entityRule?.minimumAmount ?? ledgerRule?.minimumAmount ?? entity?.minCashReserve
  return resolved ? resolved.toFixed(2) : null
}
