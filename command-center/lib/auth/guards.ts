import 'server-only'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import { getSession, type SessionUser } from '@/lib/auth/session'

/**
 * Tenant scope. The only way to obtain one is through a guard in this module,
 * and every service function requires one. That makes "did you remember to
 * filter by workspace?" a compile-time question rather than a review question.
 */
export type WorkspaceScope = {
  readonly workspaceId: string
  readonly userId: string
  readonly role: Role
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/** Capability model. Roles are compared against these sets, never string-matched inline. */
export const CAPABILITIES = {
  read: ['OWNER', 'ADMIN', 'MEMBER', 'ACCOUNTANT', 'VIEWER'],
  write: ['OWNER', 'ADMIN', 'MEMBER', 'ACCOUNTANT'],
  linkInstitution: ['OWNER', 'ADMIN', 'MEMBER'],
  initiatePayment: ['OWNER', 'ADMIN'],
  manageMembers: ['OWNER'],
  viewAudit: ['OWNER', 'ADMIN'],
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role)
}

export function scopeOf(session: SessionUser): WorkspaceScope {
  return { workspaceId: session.workspaceId, userId: session.userId, role: session.role }
}

/** For Server Components: bounce to login rather than throwing. */
export async function requireSessionOrRedirect(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.mfaEnabled && !session.mfaSatisfied) redirect('/mfa')
  return session
}

/** For Route Handlers: throw, and let the handler map it to a status code. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new AuthorizationError('Authentication required', 401)
  if (session.mfaEnabled && !session.mfaSatisfied) {
    throw new AuthorizationError('Multi-factor authentication required', 401)
  }
  return session
}

export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const session = await requireSession()
  if (!can(session.role, capability)) {
    throw new AuthorizationError(`Your role (${session.role}) cannot ${capability}`)
  }
  return session
}

export async function requireScope(capability: Capability = 'read'): Promise<WorkspaceScope> {
  return scopeOf(await requireCapability(capability))
}
