import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { exchangeAndLink } from '@/lib/services/linking'
import { syncItem } from '@/lib/services/sync'
import { regenerateInsights } from '@/lib/services/insights'
import { parseFilters } from '@/lib/validation/filters'
import { handleApiError } from '@/lib/api'

const schema = z.object({
  publicToken: z.string().min(1),
  entityId: z.string().min(1),
})

/**
 * Exchanges the single-use public token server-side. The durable access token
 * is sealed before storage and is never included in the response.
 */
export async function POST(request: Request) {
  try {
    const scope = await requireScope('linkInstitution')
    const context = await requestContext()
    const body = schema.parse(await request.json())

    const { itemId, institutionName } = await exchangeAndLink({
      scope,
      publicToken: body.publicToken,
      entityId: body.entityId,
      context,
    })

    const result = await syncItem({ scope, itemId, entityId: body.entityId, context })
    await regenerateInsights(scope, parseFilters({ period: 'this-month' }))

    return NextResponse.json({ ok: true, institutionName, result })
  } catch (error) {
    return handleApiError(error)
  }
}
