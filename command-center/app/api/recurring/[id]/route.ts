import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { updateSeries } from '@/lib/services/recurring'
import { promoteSeriesToBill } from '@/lib/services/bills'
import { handleApiError } from '@/lib/api'

const schema = z.object({
  /** "add" promotes the proposal to a bill; the rest are edits in place. */
  action: z.enum(['add', 'ignore', 'edit']),
  fundingAccountId: z.string().min(1).nullable().optional(),
  autopay: z.boolean().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  averageAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  cadence: z
    .enum(['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'])
    .optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const { id } = await params
    const body = schema.parse(await request.json())

    if (body.action === 'add') {
      const bill = await promoteSeriesToBill({
        scope,
        seriesId: id,
        fundingAccountId: body.fundingAccountId ?? null,
        ...(body.autopay !== undefined ? { autopay: body.autopay } : {}),
        context,
      })
      return NextResponse.json({ ok: true, billId: bill.id })
    }

    if (body.action === 'ignore') {
      await updateSeries({ scope, seriesId: id, status: 'IGNORED', context })
      return NextResponse.json({ ok: true })
    }

    await updateSeries({
      scope,
      seriesId: id,
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.averageAmount ? { averageAmount: body.averageAmount } : {}),
      ...(body.cadence ? { cadence: body.cadence } : {}),
      context,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
