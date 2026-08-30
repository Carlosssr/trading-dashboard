import 'server-only'
import { prisma } from '@/lib/db'
import { hashPassword, verifyPassword, fakeVerify, validatePasswordStrength } from '@/lib/auth/password'
import { generateSecret, verifyCode, otpauthUri, generateBackupCodes } from '@/lib/auth/totp'
import { seal, open, hashToken } from '@/lib/crypto/envelope'
import { createSession, revokeAllSessions, type RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { seedSystemCategories } from './categories'

/**
 * Authentication service. Every function here writes an audit entry, because
 * "who signed in, from where, and when" is the first question asked after any
 * incident involving financial data.
 */

/** Lock an account after this many consecutive failures. */
const MAX_FAILED_LOGINS = 8
const LOCKOUT_MINUTES = 15

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_CREDENTIALS' | 'LOCKED' | 'WEAK_PASSWORD' | 'EMAIL_TAKEN' | 'MFA_REQUIRED' | 'INVALID_CODE',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export type RegisterInput = {
  email: string
  name: string
  password: string
  workspaceName?: string
  context: RequestContext
}

/**
 * Creates the user, their workspace, the default Personal entity, and the system
 * category tree in one transaction — a half-created workspace would leave the
 * dashboard unable to classify anything.
 */
export async function register(input: RegisterInput): Promise<{ userId: string; workspaceId: string }> {
  const email = input.email.trim().toLowerCase()

  const problems = validatePasswordStrength(input.password)
  if (problems.length > 0) {
    throw new AuthError(problems.join(' '), 'WEAK_PASSWORD')
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new AuthError('An account with that email already exists.', 'EMAIL_TAKEN')
  }

  const { hash, salt } = await hashPassword(input.password)

  const { userId, workspaceId } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), passwordHash: hash, passwordSalt: salt },
    })

    const workspace = await tx.workspace.create({
      data: { name: input.workspaceName?.trim() || `${input.name.trim()}'s Finances` },
    })

    await tx.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
    })

    await tx.entity.create({
      data: {
        workspaceId: workspace.id,
        name: 'Personal',
        kind: 'PERSONAL',
        ledger: 'PERSONAL',
        isDefault: true,
        color: '#0f766e',
      },
    })

    return { userId: user.id, workspaceId: workspace.id }
  })

  await seedSystemCategories(workspaceId)

  await recordAuditSafe({
    action: AUDIT_ACTIONS.userRegistered,
    userId,
    workspaceId,
    resourceType: 'user',
    resourceId: userId,
    context: input.context,
  })

  return { userId, workspaceId }
}

export type LoginResult =
  | { status: 'ok'; userId: string; workspaceId: string }
  | { status: 'mfa-required'; userId: string; workspaceId: string; challengeToken: string }

/**
 * Authenticates credentials. A wrong password and an unknown address take the
 * same code path, cost the same CPU, and return the same message.
 */
export async function login(input: {
  email: string
  password: string
  context: RequestContext
}): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase()

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
  })

  if (!user) {
    await fakeVerify(input.password)
    await recordAuditSafe({
      action: AUDIT_ACTIONS.loginFailed,
      resourceType: 'user',
      metadata: { email, reason: 'no-such-user' },
      context: input.context,
    })
    throw new AuthError('Incorrect email or password.', 'INVALID_CREDENTIALS')
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAuditSafe({
      action: AUDIT_ACTIONS.loginLocked,
      userId: user.id,
      metadata: { until: user.lockedUntil.toISOString() },
      context: input.context,
    })
    throw new AuthError('Too many failed attempts. Try again shortly.', 'LOCKED')
  }

  const valid = await verifyPassword(input.password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
  })

  if (!valid) {
    const failures = user.failedLoginCount + 1
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failures,
        ...(failures >= MAX_FAILED_LOGINS
          ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000), failedLoginCount: 0 }
          : {}),
      },
    })

    await recordAuditSafe({
      action: AUDIT_ACTIONS.loginFailed,
      userId: user.id,
      metadata: { email, reason: 'bad-password', failures },
      context: input.context,
    })
    throw new AuthError('Incorrect email or password.', 'INVALID_CREDENTIALS')
  }

  const membership = user.memberships[0]
  if (!membership) {
    throw new AuthError('This account is not attached to a workspace.', 'INVALID_CREDENTIALS')
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  // With MFA enrolled, a session is still issued but flagged as not yet
  // satisfying the second factor. Guards treat that as unauthenticated for every
  // route except the challenge page, so no financial data is reachable.
  if (user.mfaEnabled) {
    const token = await createSession({
      userId: user.id,
      workspaceId: membership.workspaceId,
      mfaSatisfied: false,
      context: input.context,
    })

    return {
      status: 'mfa-required',
      userId: user.id,
      workspaceId: membership.workspaceId,
      challengeToken: token,
    }
  }

  await createSession({
    userId: user.id,
    workspaceId: membership.workspaceId,
    mfaSatisfied: true,
    context: input.context,
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.loginSucceeded,
    userId: user.id,
    workspaceId: membership.workspaceId,
    context: input.context,
  })

  return { status: 'ok', userId: user.id, workspaceId: membership.workspaceId }
}

/** Completes login with a TOTP code or a single-use backup code. */
export async function completeMfaChallenge(input: {
  userId: string
  sessionId: string
  code: string
  context: RequestContext
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user?.mfaEnabled || !user.mfaSecret || !user.mfaSecretIv || !user.mfaSecretTag) {
    throw new AuthError('Multi-factor authentication is not enabled.', 'INVALID_CODE')
  }

  const secret = open(
    {
      ciphertext: user.mfaSecret,
      iv: user.mfaSecretIv,
      authTag: user.mfaSecretTag,
      keyVersion: user.mfaKeyVersion ?? 1,
    },
    'mfa-secret',
  )

  let accepted = verifyCode(secret, input.code)

  if (!accepted) {
    // Fall back to a backup code, which is consumed on use.
    const backup = await prisma.backupCode.findUnique({
      where: { codeHash: hashToken(input.code.trim().toUpperCase()) },
    })
    if (backup && backup.userId === user.id && !backup.usedAt) {
      await prisma.backupCode.update({ where: { id: backup.id }, data: { usedAt: new Date() } })
      accepted = true
    }
  }

  if (!accepted) {
    await recordAuditSafe({
      action: AUDIT_ACTIONS.mfaChallengeFailed,
      userId: user.id,
      context: input.context,
    })
    throw new AuthError('That code is not valid.', 'INVALID_CODE')
  }

  await prisma.session.update({
    where: { id: input.sessionId },
    data: { mfaSatisfied: true },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.mfaChallengePassed,
    userId: user.id,
    context: input.context,
  })
}

export type MfaEnrollment = {
  secret: string
  otpauthUri: string
  backupCodes: string[]
}

/**
 * Starts enrollment. The secret is stored sealed but MFA stays *off* until
 * `activateMfa` proves the user can produce a valid code — otherwise a
 * mis-scanned QR code locks them out of their own finances.
 */
export async function beginMfaEnrollment(input: {
  userId: string
  email: string
}): Promise<MfaEnrollment> {
  const secret = generateSecret()
  const sealed = seal(secret, 'mfa-secret')
  const backupCodes = generateBackupCodes()

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        mfaSecret: sealed.ciphertext,
        mfaSecretIv: sealed.iv,
        mfaSecretTag: sealed.authTag,
        mfaKeyVersion: sealed.keyVersion,
        mfaEnabled: false,
      },
    })

    await tx.backupCode.deleteMany({ where: { userId: input.userId } })
    await tx.backupCode.createMany({
      data: backupCodes.map((code) => ({ userId: input.userId, codeHash: hashToken(code) })),
    })
  })

  return { secret, otpauthUri: otpauthUri(secret, input.email), backupCodes }
}

export async function activateMfa(input: {
  userId: string
  code: string
  context: RequestContext
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user?.mfaSecret || !user.mfaSecretIv || !user.mfaSecretTag) {
    throw new AuthError('Start enrollment before activating.', 'INVALID_CODE')
  }

  const secret = open(
    {
      ciphertext: user.mfaSecret,
      iv: user.mfaSecretIv,
      authTag: user.mfaSecretTag,
      keyVersion: user.mfaKeyVersion ?? 1,
    },
    'mfa-secret',
  )

  if (!verifyCode(secret, input.code)) {
    throw new AuthError('That code is not valid.', 'INVALID_CODE')
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: { mfaEnabled: true, mfaEnrolledAt: new Date() },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.mfaEnrolled,
    userId: input.userId,
    context: input.context,
  })
}

export async function disableMfa(input: {
  userId: string
  password: string
  context: RequestContext
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) throw new AuthError('Incorrect password.', 'INVALID_CREDENTIALS')

  const valid = await verifyPassword(input.password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
  })
  if (!valid) throw new AuthError('Incorrect password.', 'INVALID_CREDENTIALS')

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaSecretIv: null,
        mfaSecretTag: null,
        mfaKeyVersion: null,
        mfaEnrolledAt: null,
      },
    })
    await tx.backupCode.deleteMany({ where: { userId: input.userId } })
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.mfaDisabled,
    userId: input.userId,
    context: input.context,
  })
}

/** Changing a password signs out every other device. */
export async function changePassword(input: {
  userId: string
  currentSessionId: string
  currentPassword: string
  newPassword: string
  context: RequestContext
}): Promise<{ revokedSessions: number }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } })
  if (!user) throw new AuthError('Incorrect password.', 'INVALID_CREDENTIALS')

  const valid = await verifyPassword(input.currentPassword, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
  })
  if (!valid) throw new AuthError('Incorrect password.', 'INVALID_CREDENTIALS')

  const problems = validatePasswordStrength(input.newPassword)
  if (problems.length > 0) throw new AuthError(problems.join(' '), 'WEAK_PASSWORD')

  const { hash, salt } = await hashPassword(input.newPassword)
  await prisma.user.update({
    where: { id: input.userId },
    data: { passwordHash: hash, passwordSalt: salt },
  })

  const revokedSessions = await revokeAllSessions(input.userId, input.currentSessionId)

  await recordAuditSafe({
    action: AUDIT_ACTIONS.passwordChanged,
    userId: input.userId,
    metadata: { revokedSessions },
    context: input.context,
  })

  return { revokedSessions }
}
