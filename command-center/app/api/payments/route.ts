import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { createDraftPayment, listPayments } from '@/lib/services/payments'
import { apiError, handleApiError, rateLimit, rateLimitKey } from '@/lib/api'

const schema = z.object({
  fundingAccountId: z.string().min(1),
  payeeName: z.string().min(1).max(160),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 1850.00'),
  scheduledFor: z.string(),
  billOccurrenceId: z.string().min(1).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
})

/**
 * Phase one of two. Creates a draft, runs the cash-reserve check, and returns
 * the sentence the user must approve together with a single-use token.
 *
 * This endpoint moves no money. Only `/api/payments/{id}/confirm` does.
 */
export async function POST(request: Request) {
  try {
    const scope = await requireScope('initiatePayment')
    const context = await requestContext()

    if (!rateLimit(rateLimitKey(request, 'payment-draft'), 30, 60 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many payment attempts. Try again later.', 429)
    }

    const body = schema.parse(await request.json())

    const confirmation = await createDraftPayment({
      scope,
      fundingAccountId: body.fundingAccountId,
      payeeName: body.payeeName,
      amount: body.amount,
      scheduledFor: new Date(body.scheduledFor),
      billOccurrenceId: body.billOccurrenceId ?? null,
      memo: body.memo ?? null,
      context,
    })

    return NextResponse.json({ ok: true, confirmation })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function GET() {
  try {
    const scope = await requireScope('read')
    const payments = await listPayments(scope)
    return NextResponse.json({ payments })
  } catch (error) {
    return handleApiError(error)
  }
}
