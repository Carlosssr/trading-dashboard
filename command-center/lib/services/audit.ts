import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { RequestContext } from '@/lib/auth/session'

/**
 * Append-only audit log. There is deliberately no update or delete function in
 * this module — the only operation the application can perform on the audit
 * trail is adding to it.
 */

export const AUDIT_ACTIONS = {
  // Authentication
  userRegistered: 'user.registered',
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  loginLocked: 'auth.login.locked',
  logout: 'auth.logout',
  passwordChanged: 'auth.password.changed',
  mfaEnrolled: 'auth.mfa.enrolled',
  mfaDisabled: 'auth.mfa.disabled',
  mfaChallengePassed: 'auth.mfa.challenge.passed',
  mfaChallengeFailed: 'auth.mfa.challenge.failed',
  sessionsRevoked: 'auth.sessions.revoked',

  // Institution linking
  institutionLinked: 'institution.linked',
  institutionUnlinked: 'institution.unlinked',
  syncRan: 'sync.ran',
  syncFailed: 'sync.failed',
  webhookRejected: 'webhook.rejected',

  // Data changes
  entityCreated: 'entity.created',
  entityUpdated: 'entity.updated',
  accountUpdated: 'account.updated',
  accountReassigned: 'account.reassigned',
  transactionUpdated: 'transaction.updated',
  ruleCreated: 'rule.created',
  ruleApplied: 'rule.applied',
  billCreated: 'bill.created',
  billUpdated: 'bill.updated',
  billMarkedPaid: 'bill.marked_paid',
  recurringConfirmed: 'recurring.confirmed',
  recurringIgnored: 'recurring.ignored',

  // Payments — every transition is recorded
  paymentCreated: 'payment.created',
  paymentConfirmed: 'payment.confirmed',
  paymentScheduled: 'payment.scheduled',
  paymentSubmitted: 'payment.submitted',
  paymentCompleted: 'payment.completed',
  paymentFailed: 'payment.failed',
  paymentCancelled: 'payment.cancelled',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export type AuditEntry = {
  action: AuditAction
  workspaceId?: string | null
  userId?: string | null
  resourceType?: string
  resourceId?: string
  metadata?: Prisma.InputJsonValue
  context?: RequestContext
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: entry.action,
      workspaceId: entry.workspaceId ?? null,
      userId: entry.userId ?? null,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ipAddress: entry.context?.ipAddress ?? null,
      userAgent: entry.context?.userAgent ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    },
  })
}

/**
 * Audit writes must never take down the operation they are recording. A failed
 * log line is reported to the server console and swallowed; the alternative —
 * a payment rolling back because its audit row could not be written — is worse.
 */
export async function recordAuditSafe(entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(entry)
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error)
  }
}

export async function listAudit(input: {
  workspaceId: string
  limit?: number
  cursor?: string
  action?: string
}) {
  return prisma.auditLog.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.action ? { action: input.action } : {}),
    },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 100,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  })
}
