import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { listEntities, createEntity } from '@/lib/services/entities'
import { handleApiError } from '@/lib/api'

const schema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['PERSONAL', 'LLC', 'S_CORP', 'C_CORP', 'PARTNERSHIP', 'TRUST', 'RENTAL_PROPERTY']),
  // Immutable after creation, so it is only accepted here.
  ledger: z.enum(['PERSONAL', 'BUSINESS']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  minCashReserve: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function GET() {
  try {
    const scope = await requireScope('read')
    const entities = await listEntities(scope)

    return NextResponse.json({
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        ledger: entity.ledger,
        color: entity.color,
        isDefault: entity.isDefault,
        minCashReserve: entity.minCashReserve ? entity.minCashReserve.toFixed(2) : null,
        accountCount: entity._count.accounts,
        transactionCount: entity._count.transactions,
        propertyCount: entity._count.properties,
      })),
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const body = schema.parse(await request.json())

    const entity = await createEntity({ scope, ...body, context })
    return NextResponse.json({ ok: true, entityId: entity.id })
  } catch (error) {
    return handleApiError(error)
  }
}
