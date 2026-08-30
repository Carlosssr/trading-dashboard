import 'server-only'
import { cookies, headers } from 'next/headers'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/db'
import { env } from '@/lib/env'
import { hashToken, randomToken } from '@/lib/crypto/envelope'

export const SESSION_COOKIE = 'fcc_session'

/** Absolute lifetime. A session cannot outlive this regardless of activity. */
const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
/** Idle timeout. A session unused for this long is treated as expired. */
const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

export type SessionUser = {
  sessionId: string
  userId: string
  email: string
  name: string
  workspaceId: string
  workspaceName: string
  role: Role
  mfaEnabled: boolean
  mfaSatisfied: boolean
}

export type RequestContext = { ipAddress: string | null; userAgent: string | null }

export async function requestContext(): Promise<RequestContext> {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : headerList.get('x-real-ip'),
    userAgent: headerList.get('user-agent'),
  }
}

/**
 * Issues a session. The raw token is returned to be set as a cookie and is never
 * persisted — only its hash is, so database read access yields nothing replayable.
 */
export async function createSession(input: {
  userId: string
  workspaceId: string
  mfaSatisfied: boolean
  context: RequestContext
}): Promise<string> {
  const token = randomToken(32)

  await prisma.session.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      tokenHash: hashToken(token),
      mfaSatisfied: input.mfaSatisfied,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      expiresAt: new Date(Date.now() + ABSOLUTE_LIFETIME_MS),
    },
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_LIFETIME_MS / 1000),
  })

  return token
}

/**
 * Resolves the current session, or null. Enforces both expiry rules and
 * refreshes `lastSeenAt` so the idle window slides with real activity.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: { include: { workspace: true } },
        },
      },
    },
  })

  if (!session || session.revokedAt) return null

  const now = Date.now()
  if (session.expiresAt.getTime() < now) return null
  if (now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) return null

  const membership = session.user.memberships.find((m) => m.workspaceId === session.workspaceId)
  if (!membership) return null

  // Throttled so a page with several server components does not issue a write
  // per component.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    })
  }

  return {
    sessionId: session.id,
    userId: session.userId,
    email: session.user.email,
    name: session.user.name,
    workspaceId: session.workspaceId,
    workspaceName: membership.workspace.name,
    role: membership.role,
    mfaEnabled: session.user.mfaEnabled,
    mfaSatisfied: session.mfaSatisfied,
  }
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  cookieStore.delete(SESSION_COOKIE)
}

/** Used on password change: every other device is signed out. */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  })
  return result.count
}
