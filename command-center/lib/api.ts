import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthorizationError } from '@/lib/auth/guards'
import { AuthError } from '@/lib/services/auth'
import { PaymentError } from '@/lib/services/payments'
import { PaymentInitiationUnavailableError } from '@/lib/providers/payments'
import { ProviderError } from '@/lib/providers/types'

/**
 * One error shape for the whole API: `{ error: { code, message, details? } }`.
 *
 * Mapping happens here rather than in each handler so a new route cannot
 * accidentally leak a stack trace or return an unhelpful 500 for a case the
 * application already models.
 */

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown }
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
}

export function handleApiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return apiError('VALIDATION_FAILED', 'Some fields need attention.', 422, error.flatten().fieldErrors)
  }

  if (error instanceof AuthorizationError) {
    return apiError(error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', error.message, error.status)
  }

  if (error instanceof AuthError) {
    const status = error.code === 'LOCKED' ? 429 : error.code === 'EMAIL_TAKEN' ? 409 : 401
    return apiError(error.code, error.message, status)
  }

  if (error instanceof PaymentInitiationUnavailableError) {
    return apiError('PAYMENT_INITIATION_UNAVAILABLE', error.message, 501)
  }

  if (error instanceof PaymentError) {
    const status =
      error.code === 'ACCOUNT_NOT_FOUND' ? 404 : error.code === 'INVALID_STATE' ? 409 : 422
    return apiError(error.code, error.message, status)
  }

  if (error instanceof ProviderError) {
    return apiError('PROVIDER_ERROR', error.message, 502)
  }

  // Anything unmodelled is logged server-side and reported without internals.
  console.error('[api] unhandled error', error)
  return apiError('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500)
}

/**
 * In-process rate limiter for auth and payment endpoints.
 *
 * Honest about its limits: this is per-instance, so on a horizontally scaled
 * deployment it bounds abuse per instance rather than globally. Moving to Redis
 * is the documented Phase 12 task; pretending an in-memory map is a global
 * guarantee would be worse than saying so.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= limit) return false

  bucket.count += 1
  return true
}

export function rateLimitKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
  return `${ip}:${suffix}`
}
