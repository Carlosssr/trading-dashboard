import { NextResponse } from 'next/server'
import { z } from 'zod'
import { register, login } from '@/lib/services/auth'
import { requestContext } from '@/lib/auth/session'
import { apiError, handleApiError, rateLimit, rateLimitKey } from '@/lib/api'

const schema = z.object({
  email: z.email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12).max(200),
  workspaceName: z.string().max(120).optional(),
})

export async function POST(request: Request) {
  try {
    if (!rateLimit(rateLimitKey(request, 'register'), 5, 60 * 60 * 1000)) {
      return apiError('RATE_LIMITED', 'Too many sign-up attempts. Try again later.', 429)
    }

    const body = schema.parse(await request.json())
    const context = await requestContext()

    await register({ ...body, context })
    // Sign the new user straight in; they have just proved the password.
    await login({ email: body.email, password: body.password, context })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
