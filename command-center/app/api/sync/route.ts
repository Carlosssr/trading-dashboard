import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { syncAll, syncItem } from '@/lib/services/sync'
import { regenerateInsights } from '@/lib/services/insights'
import { parseFilters } from '@/lib/validation/filters'
import { handleApiError } from '@/lib/api'

const schema = z.object({ itemId: z.string().min(1).optional() })

export async function POST(request: Request) {
  try {
    const scope = await requireScope('linkInstitution')
    const context = await requestContext()

    const body = request.headers.get('content-type')?.includes('application/json')
      ? schema.parse(await request.json())
      : {}

    const results = body.itemId
      ? [await syncItem({ scope, itemId: body.itemId, context })]
      : await syncAll({ scope, context })

    // Insights are derived from the freshly synced figures, so regenerating
    // here keeps the dashboard's narrative in step with its numbers.
    await regenerateInsights(scope, parseFilters({ period: 'this-month' }))

    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return handleApiError(error)
  }
}
