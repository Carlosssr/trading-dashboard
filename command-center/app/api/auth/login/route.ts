import { NextResponse } from 'next/server'
import { z } from 'zod'
import { login } from '@/lib/services/auth'
import { requestContext } from '@/lib/auth/session'
import { apiError, handleApiError, rateLimit, rateLimitKey } from '@/lib/api'

const schema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json())

    // Limited per IP and per account, so neither a single noisy address nor a
    // spray across many addresses gets unlimited attempts at one account.
    if (!rateLimit(rateLimitKey(request, 'login'), 10, 15 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many attempts. Try again shortly.', 429)
    }
    if (!rateLimit(`account:${body.email.toLowerCase()}`, 10, 15 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many attempts. Try again shortly.', 429)
    }

    const context = await requestContext()
    const result = await login({ ...body, context })

    return NextResponse.json({
      ok: true,
      mfaRequired: result.status === 'mfa-required',
    })
  } catch (error) {
    return handleApiError(error)
  }
}
