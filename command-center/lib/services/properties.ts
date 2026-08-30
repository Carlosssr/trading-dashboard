import 'server-only'
import { startOfDay } from 'date-fns'
import type { PropertyType, ValuationSource } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { PropertyInput } from '@/lib/finance/real-estate'
import { backfillSnapshots } from './snapshots'

/**
 * Real estate.
 *
 * A property's value is carried by a manual asset account, so net worth, the
 * accounts list, and the balance-snapshot trend pick up real estate through the
 * same path as everything else rather than through a special case. This module
 * owns keeping that account's balance equal to `estimatedValue`.
 */

export type UpsertPropertyInput = {
  scope: WorkspaceScope
  id?: string
  entityId: string
  name: string
  addressLine1?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  propertyType: PropertyType
  purchaseDate?: Date | null
  purchasePrice?: string | null
  estimatedValue: string
  isRental: boolean
  monthlyRent?: string
  monthlyPropertyTax?: string
  monthlyInsurance?: string
  monthlyHoa?: string
  monthlyOtherExpenses?: string
  mortgageAccountId?: string | null
  manualMortgageBalance?: string | null
  manualMortgagePayment?: string | null
  manualMortgageRate?: number | null
  notes?: string | null
}

export async function upsertProperty(input: UpsertPropertyInput) {
  const entity = await prisma.entity.findFirst({
    where: { id: input.entityId, workspaceId: input.scope.workspaceId },
  })
  if (!entity) throw new Error('Entity not found in this workspace')

  const data = {
    workspaceId: input.scope.workspaceId,
    entityId: entity.id,
    ledger: entity.ledger,
    name: input.name.trim(),
    addressLine1: input.addressLine1 ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    propertyType: input.propertyType,
    purchaseDate: input.purchaseDate ?? null,
    purchasePrice: input.purchasePrice ?? null,
    estimatedValue: input.estimatedValue,
    isRental: input.isRental,
    monthlyRent: input.monthlyRent ?? '0',
    monthlyPropertyTax: input.monthlyPropertyTax ?? '0',
    monthlyInsurance: input.monthlyInsurance ?? '0',
    monthlyHoa: input.monthlyHoa ?? '0',
    monthlyOtherExpenses: input.monthlyOtherExpenses ?? '0',
    mortgageAccountId: input.mortgageAccountId ?? null,
    manualMortgageBalance: input.manualMortgageBalance ?? null,
    manualMortgagePayment: input.manualMortgagePayment ?? null,
    manualMortgageRate: input.manualMortgageRate ?? null,
    notes: input.notes ?? null,
    valuationSource: 'MANUAL' as ValuationSource,
    valuationAsOf: new Date(),
  }

  const property = input.id
    ? await prisma.property.update({ where: { id: input.id }, data })
    : await prisma.property.create({ data })

  await syncValueAccount(property.id)
  await recordValuation({
    propertyId: property.id,
    value: input.estimatedValue,
    source: 'MANUAL',
  })

  // A property's value account is created outside the sync pipeline, so it needs
  // its own backfill — otherwise the net-worth trend runs flat for a year and
  // then jumps by the whole portfolio on the day the property was added.
  await backfillSnapshots(input.scope.workspaceId)

  return property
}

/**
 * Creates or updates the manual asset account that carries this property's
 * value, and writes today's balance snapshot so the net-worth trend moves when a
 * valuation changes.
 */
export async function syncValueAccount(propertyId: string): Promise<void> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { entity: true },
  })
  if (!property) return

  const accountData = {
    workspaceId: property.workspaceId,
    entityId: property.entityId,
    ledger: property.ledger,
    classification: 'REAL_ESTATE' as const,
    type: 'PROPERTY' as const,
    institutionName: 'Manual',
    name: property.name,
    currentBalance: property.estimatedValue,
    isManual: true,
    provider: 'MANUAL' as const,
  }

  const account = property.valueAccountId
    ? await prisma.account.update({
        where: { id: property.valueAccountId },
        data: {
          name: property.name,
          currentBalance: property.estimatedValue,
          entityId: property.entityId,
          ledger: property.ledger,
        },
      })
    : await prisma.account.create({ data: accountData })

  if (!property.valueAccountId) {
    await prisma.property.update({
      where: { id: property.id },
      data: { valueAccountId: account.id },
    })
  }

  const today = startOfDay(new Date())
  await prisma.accountBalanceSnapshot.upsert({
    where: { accountId_asOf: { accountId: account.id, asOf: today } },
    update: { current: property.estimatedValue },
    create: { accountId: account.id, asOf: today, current: property.estimatedValue },
  })
}

/** Append-only valuation history. */
export async function recordValuation(input: {
  propertyId: string
  value: string
  source: ValuationSource
  asOf?: Date
  note?: string
}) {
  const asOf = startOfDay(input.asOf ?? new Date())

  return prisma.propertyValuation.upsert({
    where: {
      propertyId_asOf_source: { propertyId: input.propertyId, asOf, source: input.source },
    },
    update: { value: input.value, note: input.note ?? null },
    create: {
      propertyId: input.propertyId,
      asOf,
      value: input.value,
      source: input.source,
      note: input.note ?? null,
    },
  })
}

export async function listProperties(
  scope: WorkspaceScope,
  filter?: { ledger?: 'PERSONAL' | 'BUSINESS'; entityId?: string },
) {
  return prisma.property.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filter?.ledger ? { ledger: filter.ledger } : {}),
      ...(filter?.entityId ? { entityId: filter.entityId } : {}),
    },
    include: {
      entity: { select: { id: true, name: true, ledger: true, color: true } },
      mortgageAccount: {
        select: { id: true, name: true, currentBalance: true, apr: true, minimumPayment: true, mask: true },
      },
      valuations: { orderBy: { asOf: 'desc' }, take: 12 },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export type PropertyWithRelations = Awaited<ReturnType<typeof listProperties>>[number]

/**
 * Maps a stored property onto the pure calculation input, preferring the linked
 * mortgage account's live balance over the manually entered figure.
 */
export function toCalculationInput(property: PropertyWithRelations): PropertyInput {
  const mortgageBalance =
    property.mortgageAccount?.currentBalance ?? property.manualMortgageBalance ?? 0
  const mortgagePayment =
    property.mortgageAccount?.minimumPayment ?? property.manualMortgagePayment ?? 0
  const mortgageRate = property.mortgageAccount?.apr
    ? property.mortgageAccount.apr.toNumber()
    : property.manualMortgageRate
      ? property.manualMortgageRate.toNumber()
      : null

  return {
    id: property.id,
    name: property.name,
    estimatedValue: property.estimatedValue,
    purchasePrice: property.purchasePrice,
    isRental: property.isRental,
    monthlyRent: property.monthlyRent,
    monthlyPropertyTax: property.monthlyPropertyTax,
    monthlyInsurance: property.monthlyInsurance,
    monthlyHoa: property.monthlyHoa,
    monthlyOtherExpenses: property.monthlyOtherExpenses,
    mortgageBalance,
    mortgagePayment,
    mortgageRate,
  }
}

export async function deleteProperty(scope: WorkspaceScope, propertyId: string): Promise<void> {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, workspaceId: scope.workspaceId },
  })
  if (!property) return

  await prisma.$transaction(async (tx) => {
    await tx.property.delete({ where: { id: property.id } })
    // The value account exists only to represent this property, so it goes too.
    if (property.valueAccountId) {
      await tx.account.deleteMany({ where: { id: property.valueAccountId, isManual: true } })
    }
  })
}
