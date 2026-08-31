import 'server-only'
import { prisma } from '@/lib/db'

/**
 * Foreign-key ownership checks.
 *
 * Tenant scoping on a *query* is not enough on its own. When a client supplies
 * the id of a related row — the funding account for a bill, a category for a
 * transaction, the account a rule pays from — Prisma will happily store that id
 * whatever workspace it belongs to, because nothing at the database level ties
 * the two workspaces together.
 *
 * The consequence is a real cross-tenant read: attach another workspace's
 * account to one of your own bills, then let the bill list `include` it, and its
 * institution, nickname, and last four come back in your own payload.
 *
 * So every client-supplied foreign key passes through here before it is written.
 * `undefined` means "not being changed" and is left alone; `null` means "clear
 * it" and is always allowed.
 */

export class OwnershipError extends Error {
  constructor(readonly resource: string) {
    super(`That ${resource} does not exist in this workspace.`)
    this.name = 'OwnershipError'
  }
}

async function assertOwned(
  resource: 'account' | 'category' | 'entity',
  workspaceId: string,
  id: string | null | undefined,
): Promise<void> {
  if (id === null || id === undefined) return

  const found =
    resource === 'account'
      ? await prisma.account.findFirst({ where: { id, workspaceId }, select: { id: true } })
      : resource === 'category'
        ? await prisma.category.findFirst({ where: { id, workspaceId }, select: { id: true } })
        : await prisma.entity.findFirst({ where: { id, workspaceId }, select: { id: true } })

  if (!found) throw new OwnershipError(resource)
}

export async function assertAccountOwned(workspaceId: string, id: string | null | undefined) {
  return assertOwned('account', workspaceId, id)
}

export async function assertCategoryOwned(workspaceId: string, id: string | null | undefined) {
  return assertOwned('category', workspaceId, id)
}

export async function assertEntityOwned(workspaceId: string, id: string | null | undefined) {
  return assertOwned('entity', workspaceId, id)
}

/** Checks several at once; the first failure wins. */
export async function assertAllOwned(
  workspaceId: string,
  refs: {
    accountIds?: (string | null | undefined)[]
    categoryIds?: (string | null | undefined)[]
    entityIds?: (string | null | undefined)[]
  },
): Promise<void> {
  for (const id of refs.accountIds ?? []) await assertAccountOwned(workspaceId, id)
  for (const id of refs.categoryIds ?? []) await assertCategoryOwned(workspaceId, id)
  for (const id of refs.entityIds ?? []) await assertEntityOwned(workspaceId, id)
}
