import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { updateTransaction } from '@/lib/services/transactions'
import { handleApiError } from '@/lib/api'

const schema = z.object({
  categoryId: z.string().min(1).nullable().optional(),
  entityId: z.string().min(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
  excludeFromReports: z.boolean().optional(),
  isTransfer: z.boolean().optional(),
  /** The user's answer to "apply this to future transactions from this merchant?" */
  applyToFuture: z.boolean().optional(),
  applyToPast: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const { id } = await params
    const body = schema.parse(await request.json())

    const result = await updateTransaction({ scope, transactionId: id, ...body, context })

    return NextResponse.json({
      ok: true,
      ruleCreated: result.ruleId !== null,
      backfilled: result.backfilled,
    })
  } catch (error) {
    return handleApiError(error)
  }
}
