import 'server-only'
import type { AccountClassification, AccountType, Ledger, ProviderItem } from '@prisma/client'
import { prisma } from '@/lib/db'
import { seal, open } from '@/lib/crypto/envelope'
import { getAggregationProvider } from '@/lib/providers'
import type { ItemHandle, LinkSession } from '@/lib/providers/types'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'

/**
 * Institution linking.
 *
 * The access token exists in plaintext only inside this module's memory, for the
 * duration of one call. It is sealed before it touches the database and opened
 * only to hand to a provider adapter.
 */

export async function createLinkSession(
  scope: WorkspaceScope,
): Promise<Omit<LinkSession, 'linkToken'> & { linkToken: string }> {
  const provider = getAggregationProvider()
  return provider.createLinkSession({ userId: scope.userId, workspaceId: scope.workspaceId })
}

/**
 * Default account category, from the account's own type and the ledger of the
 * entity it is being filed under. Users can reassign afterwards.
 */
export function defaultClassification(type: AccountType, ledger: Ledger): AccountClassification {
  if (type === 'INVESTMENT' || type === 'RETIREMENT') return 'INVESTMENT'
  if (type === 'MORTGAGE' || type === 'PROPERTY') return 'REAL_ESTATE'
  return ledger === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL'
}

export type ExchangeInput = {
  scope: WorkspaceScope
  publicToken: string
  entityId: string
  context: RequestContext
}

/**
 * Exchanges a single-use public token for a durable access token, stores it
 * sealed, and creates the institution and item rows. Account and transaction
 * population is left to the sync service so that both the first load and every
 * later refresh run exactly the same code.
 */
export async function exchangeAndLink(input: ExchangeInput): Promise<{ itemId: string; institutionName: string }> {
  const entity = await prisma.entity.findFirst({
    where: { id: input.entityId, workspaceId: input.scope.workspaceId },
  })
  if (!entity) throw new Error('Entity not found in this workspace')

  const provider = getAggregationProvider()
  const linked = await provider.exchangePublicToken({ publicToken: input.publicToken })

  const institution = await prisma.institution.upsert({
    where: {
      workspaceId_provider_providerInstitutionId: {
        workspaceId: input.scope.workspaceId,
        provider: provider.name,
        providerInstitutionId: linked.institution.providerInstitutionId,
      },
    },
    update: {
      name: linked.institution.name,
      logoUrl: linked.institution.logoUrl ?? null,
      primaryColor: linked.institution.primaryColor ?? null,
      website: linked.institution.website ?? null,
    },
    create: {
      workspaceId: input.scope.workspaceId,
      provider: provider.name,
      providerInstitutionId: linked.institution.providerInstitutionId,
      name: linked.institution.name,
      logoUrl: linked.institution.logoUrl ?? null,
      primaryColor: linked.institution.primaryColor ?? null,
      website: linked.institution.website ?? null,
    },
  })

  const sealed = seal(linked.accessToken, 'provider-access-token')

  const item = await prisma.providerItem.upsert({
    where: {
      provider_providerItemId: {
        provider: provider.name,
        providerItemId: linked.providerItemId,
      },
    },
    update: {
      accessTokenCiphertext: sealed.ciphertext,
      accessTokenIv: sealed.iv,
      accessTokenTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
      status: 'ACTIVE',
      lastError: null,
    },
    create: {
      workspaceId: input.scope.workspaceId,
      institutionId: institution.id,
      provider: provider.name,
      providerItemId: linked.providerItemId,
      accessTokenCiphertext: sealed.ciphertext,
      accessTokenIv: sealed.iv,
      accessTokenTag: sealed.authTag,
      keyVersion: sealed.keyVersion,
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.institutionLinked,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'provider_item',
    resourceId: item.id,
    metadata: { institution: institution.name, entityId: input.entityId },
    context: input.context,
  })

  return { itemId: item.id, institutionName: institution.name }
}

/** Opens the sealed token. Never call this anywhere the result could be serialized to a client. */
export function itemHandle(item: Pick<ProviderItem, 'providerItemId' | 'accessTokenCiphertext' | 'accessTokenIv' | 'accessTokenTag' | 'keyVersion'>): ItemHandle {
  return {
    providerItemId: item.providerItemId,
    accessToken: open(
      {
        ciphertext: item.accessTokenCiphertext,
        iv: item.accessTokenIv,
        authTag: item.accessTokenTag,
        keyVersion: item.keyVersion,
      },
      'provider-access-token',
    ),
  }
}

/** Item list for the UI. The select list is explicit so no token field can leak. */
export async function listItems(scope: WorkspaceScope) {
  return prisma.providerItem.findMany({
    where: { workspaceId: scope.workspaceId },
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
      lastSyncedAt: true,
      consentExpiresAt: true,
      createdAt: true,
      institution: { select: { id: true, name: true, logoUrl: true, primaryColor: true } },
      _count: { select: { accounts: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Revokes access at the provider, then removes the local token. Accounts and
 * their transaction history are kept and marked disconnected — unlinking an
 * institution should not erase a year of financial records.
 */
export async function unlinkItem(input: {
  scope: WorkspaceScope
  itemId: string
  context: RequestContext
}): Promise<void> {
  const item = await prisma.providerItem.findFirst({
    where: { id: input.itemId, workspaceId: input.scope.workspaceId },
    include: { institution: true },
  })
  if (!item) throw new Error('Linked institution not found')

  const provider = getAggregationProvider()
  try {
    await provider.removeItem(itemHandle(item))
  } catch (error) {
    // A provider-side failure must not strand the token locally; the local
    // record is the thing we can actually guarantee removal of.
    console.error('[linking] provider removeItem failed, continuing with local removal', error)
  }

  await prisma.$transaction(async (tx) => {
    await tx.account.updateMany({
      where: { providerItemId: item.id },
      data: { isDisconnected: true, providerItemId: null },
    })
    await tx.providerItem.delete({ where: { id: item.id } })
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.institutionUnlinked,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'provider_item',
    resourceId: item.id,
    metadata: { institution: item.institution.name },
    context: input.context,
  })
}
