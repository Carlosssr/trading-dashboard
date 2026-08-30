import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { markOccurrencePaid } from '@/lib/services/bills'
import { apiError, handleApiError } from '@/lib/api'

const schema = z.object({
  action: z.enum(['mark-paid', 'skip', 'reopen']),
  paidAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
})

/**
 * Manual bill tracking.
 *
 * Marking a bill paid here records that the user says it was paid — it does not
 * create a Payment and does not claim this application moved any money. The
 * `paidSource` column keeps the two apart in the audit trail.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const { id } = await params
    const body = schema.parse(await request.json())

    const occurrence = await prisma.billOccurrence.findFirst({
      where: { id, bill: { workspaceId: scope.workspaceId } },
    })
    if (!occurrence) return apiError('NOT_FOUND', 'Bill occurrence not found.', 404)

    if (body.action === 'mark-paid') {
      await markOccurrencePaid({
        scope,
        occurrenceId: id,
        ...(body.paidAmount ? { paidAmount: body.paidAmount } : {}),
        context,
      })
    } else if (body.action === 'skip') {
      await prisma.billOccurrence.update({ where: { id }, data: { status: 'SKIPPED' } })
    } else {
      // Reopening clears every trace of the payment claim, including the
      // matched transaction — otherwise a re-run of bill matching would just
      // mark it paid again from stale evidence.
      await prisma.billOccurrence.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          paidAt: null,
          paidAmount: null,
          paidSource: null,
          markedByUserId: null,
          matchedTransactionId: null,
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
