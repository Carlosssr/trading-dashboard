import { NextResponse } from 'next/server'
import { z } from 'zod'
import { completeMfaChallenge } from '@/lib/services/auth'
import { getSession, requestContext } from '@/lib/auth/session'
import { apiError, handleApiError, rateLimit, rateLimitKey } from '@/lib/api'

const schema = z.object({ code: z.string().min(6).max(20) })

export async function POST(request: Request) {
  try {
    if (!rateLimit(rateLimitKey(request, 'mfa'), 10, 15 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many attempts. Try again shortly.', 429)
    }

    // Read the raw session rather than going through requireSession: the guards
    // treat an unsatisfied second factor as unauthenticated, and this endpoint is
    // the one that exists to satisfy it.
    const session = await getSession()
    if (!session) return apiError('UNAUTHENTICATED', 'Sign in again.', 401)

    const { code } = schema.parse(await request.json())
    const context = await requestContext()

    await completeMfaChallenge({
      userId: session.userId,
      sessionId: session.sessionId,
      code,
      context,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
