import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { confirmPayment } from '@/lib/services/payments'
import { apiError, handleApiError, rateLimit, rateLimitKey } from '@/lib/api'

const schema = z.object({ token: z.string().min(1) })

/**
 * Phase two. The only endpoint in the application that reaches a payment
 * provider, and it requires the single-use token issued with the confirmation
 * sentence — so a payment cannot be initiated without the user having been shown
 * exactly what they were approving.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('initiatePayment')
    const context = await requestContext()

    if (!rateLimit(rateLimitKey(request, 'payment-confirm'), 30, 60 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many payment attempts. Try again later.', 429)
    }

    const { id } = await params
    const { token } = schema.parse(await request.json())

    const payment = await confirmPayment({ scope, paymentId: id, token, context })

    return NextResponse.json({
      ok: true,
      payment: {
        id: payment.id,
        status: payment.status,
        scheduledFor: payment.scheduledFor,
        amount: payment.amount.toFixed(2),
      },
    })
  } catch (error) {
    return handleApiError(error)
  }
}
