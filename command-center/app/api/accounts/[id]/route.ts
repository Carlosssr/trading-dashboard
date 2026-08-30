import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { reassignAccount } from '@/lib/services/entities'
import { AUDIT_ACTIONS, recordAuditSafe } from '@/lib/services/audit'
import { apiError, handleApiError } from '@/lib/api'

const schema = z.object({
  entityId: z.string().min(1).optional(),
  classification: z.enum(['PERSONAL', 'BUSINESS', 'INVESTMENT', 'REAL_ESTATE']).optional(),
  name: z.string().min(1).max(120).optional(),
  currentBalance: z.string().optional(),
  creditLimit: z.string().nullable().optional(),
  apr: z.number().min(0).max(1).nullable().optional(),
  minimumPayment: z.string().nullable().optional(),
  includeInNetWorth: z.boolean().optional(),
  isClosed: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const { id } = await params
    const body = schema.parse(await request.json())

    const account = await prisma.account.findFirst({
      where: { id, workspaceId: scope.workspaceId },
    })
    if (!account) return apiError('NOT_FOUND', 'Account not found.', 404)

    let transactionsMoved = 0

    // Entity reassignment is its own service call: it has to move the ledger and
    // every transaction with it, which a field update cannot express.
    if (body.entityId && body.entityId !== account.entityId) {
      const result = await reassignAccount({ scope, accountId: id, entityId: body.entityId, context })
      transactionsMoved = result.transactionsMoved
    }

    // A manual balance is only meaningful on a manual account; a synced balance
    // would be overwritten by the provider on the next refresh.
    if (body.currentBalance && !account.isManual) {
      return apiError(
        'SYNCED_ACCOUNT',
        'This balance comes from the connected institution and cannot be edited by hand.',
        409,
      )
    }

    const updated = await prisma.account.update({
      where: { id },
      data: {
        ...(body.classification ? { classification: body.classification } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.currentBalance ? { currentBalance: body.currentBalance } : {}),
        ...(body.creditLimit !== undefined ? { creditLimit: body.creditLimit } : {}),
        ...(body.apr !== undefined ? { apr: body.apr } : {}),
        ...(body.minimumPayment !== undefined ? { minimumPayment: body.minimumPayment } : {}),
        ...(body.includeInNetWorth !== undefined ? { includeInNetWorth: body.includeInNetWorth } : {}),
        ...(body.isClosed !== undefined ? { isClosed: body.isClosed } : {}),
      },
    })

    await recordAuditSafe({
      action: AUDIT_ACTIONS.accountUpdated,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      resourceType: 'account',
      resourceId: id,
      metadata: { fields: Object.keys(body), transactionsMoved },
      context,
    })

    return NextResponse.json({ ok: true, transactionsMoved, account: { id: updated.id } })
  } catch (error) {
    return handleApiError(error)
  }
}
