import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { createBill, listBills, updateBill } from '@/lib/services/bills'
import { handleApiError } from '@/lib/api'

const createSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1).max(160),
  payeeName: z.string().min(1).max(160),
  expectedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  cadence: z.enum([
    'WEEKLY',
    'BIWEEKLY',
    'SEMIMONTHLY',
    'MONTHLY',
    'QUARTERLY',
    'SEMIANNUAL',
    'ANNUAL',
  ]),
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  fundingAccountId: z.string().min(1).nullable().optional(),
  targetAccountId: z.string().min(1).nullable().optional(),
  autopay: z.boolean().optional(),
  amountType: z.enum(['FIXED', 'VARIABLE']).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const updateSchema = z.object({
  billId: z.string().min(1),
  autopay: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
  expectedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  fundingAccountId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function GET() {
  try {
    const scope = await requireScope('read')
    return NextResponse.json({ bills: await listBills(scope) })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const body = createSchema.parse(await request.json())

    const bill = await createBill({ scope, ...body, context })
    return NextResponse.json({ ok: true, billId: bill.id })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const scope = await requireScope('write')
    const context = await requestContext()
    const { billId, fundingAccountId, ...rest } = updateSchema.parse(await request.json())

    await updateBill({
      scope,
      billId,
      data: {
        ...rest,
        ...(fundingAccountId !== undefined
          ? fundingAccountId === null
            ? { fundingAccount: { disconnect: true } }
            : { fundingAccount: { connect: { id: fundingAccountId } } }
          : {}),
      },
      context,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
