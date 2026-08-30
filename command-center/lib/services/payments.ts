import 'server-only'
import { startOfDay } from 'date-fns'
import type { PaymentStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashToken, randomToken, constantTimeEquals } from '@/lib/crypto/envelope'
import { formatMoney, money } from '@/lib/finance/money'
import { cashReserveWarning } from '@/lib/finance/bills'
import { getPaymentProvider, PaymentInitiationUnavailableError } from '@/lib/providers/payments'
import type { WorkspaceScope } from '@/lib/auth/guards'
import type { RequestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from './audit'
import { resolveReserveFor } from './entities'

/**
 * Payments — strictly two-phase.
 *
 *   Phase 1 (`createDraftPayment`) computes the confirmation sentence and the
 *   cash-reserve warnings, stores a single-use confirmation token, and moves
 *   nothing.
 *
 *   Phase 2 (`confirmPayment`) requires that token and only then talks to the
 *   payment provider.
 *
 * `COMPLETED` is reachable from exactly one function — `settlePayment` — which
 * is called by provider confirmations, never by a request handler acting on a
 * user's click.
 */

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ACCOUNT_NOT_FOUND'
      | 'INVALID_STATE'
      | 'BAD_CONFIRMATION'
      | 'PROVIDER_UNAVAILABLE'
      | 'INVALID_AMOUNT',
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

export type DraftPaymentInput = {
  scope: WorkspaceScope
  fundingAccountId: string
  payeeName: string
  amount: string
  scheduledFor: Date
  billOccurrenceId?: string | null
  memo?: string | null
  context?: RequestContext
}

export type PaymentConfirmation = {
  paymentId: string
  /** The exact sentence the user must approve. */
  sentence: string
  warnings: string[]
  /** Single-use; required by `confirmPayment`. */
  token: string
  amount: string
  scheduledFor: Date
  fundingAccountLabel: string
  providerSupportsInitiation: boolean
}

export async function createDraftPayment(input: DraftPaymentInput): Promise<PaymentConfirmation> {
  const amount = money(input.amount)
  if (amount.lessThanOrEqualTo(0)) {
    throw new PaymentError('A payment amount must be greater than zero.', 'INVALID_AMOUNT')
  }

  const account = await prisma.account.findFirst({
    where: { id: input.fundingAccountId, workspaceId: input.scope.workspaceId },
    include: { entity: { select: { id: true, name: true, ledger: true } } },
  })
  if (!account) {
    throw new PaymentError('Funding account not found in this workspace.', 'ACCOUNT_NOT_FOUND')
  }

  const reserve = await resolveReserveFor({
    workspaceId: input.scope.workspaceId,
    entityId: account.entityId,
    ledger: account.ledger,
  })

  const warnings: string[] = []
  const reserveWarning = cashReserveWarning({
    availableBalance: account.availableBalance ?? account.currentBalance,
    paymentAmount: amount,
    minimumReserve: reserve,
  })
  if (reserveWarning) warnings.push(reserveWarning)

  const provider = getPaymentProvider()
  if (!provider.supportsPaymentInitiation) {
    warnings.push(
      'This deployment cannot initiate payments. Confirming will record the payment for tracking only.',
    )
  }

  const fundingAccountLabel = `${account.institutionName} ${account.name}${
    account.mask ? ` ending in ${account.mask}` : ''
  }`

  // The sentence is stored, not just rendered, so the audit trail shows exactly
  // what the user was asked to approve.
  const sentence = `You're about to pay ${formatMoney(amount)} from ${fundingAccountLabel}.`

  const token = randomToken(24)

  const payment = await prisma.payment.create({
    data: {
      workspaceId: input.scope.workspaceId,
      entityId: account.entityId,
      ledger: account.ledger,
      fundingAccountId: account.id,
      billOccurrenceId: input.billOccurrenceId ?? null,
      payeeName: input.payeeName.trim(),
      amount: amount.toFixed(2),
      scheduledFor: startOfDay(input.scheduledFor),
      memo: input.memo ?? null,
      status: 'PENDING_CONFIRMATION',
      provider: provider.name,
      confirmationTokenHash: hashToken(token),
      confirmationSentence: sentence,
      warnings: warnings.length > 0 ? warnings : undefined,
      createdByUserId: input.scope.userId,
    },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.paymentCreated,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'payment',
    resourceId: payment.id,
    metadata: {
      amount: amount.toFixed(2),
      payee: payment.payeeName,
      fundingAccount: fundingAccountLabel,
      scheduledFor: payment.scheduledFor.toISOString(),
      warnings,
    },
    ...(input.context ? { context: input.context } : {}),
  })

  return {
    paymentId: payment.id,
    sentence,
    warnings,
    token,
    amount: amount.toFixed(2),
    scheduledFor: payment.scheduledFor,
    fundingAccountLabel,
    providerSupportsInitiation: provider.supportsPaymentInitiation,
  }
}

/**
 * The only path that reaches a payment provider. Requires the single-use token
 * from phase one and a payment still awaiting confirmation.
 */
export async function confirmPayment(input: {
  scope: WorkspaceScope
  paymentId: string
  token: string
  context?: RequestContext
}) {
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, workspaceId: input.scope.workspaceId },
    include: { fundingAccount: { select: { providerAccountId: true } } },
  })
  if (!payment) throw new PaymentError('Payment not found.', 'ACCOUNT_NOT_FOUND')

  if (payment.status !== 'PENDING_CONFIRMATION') {
    throw new PaymentError(
      `This payment is ${payment.status.toLowerCase().replace('_', ' ')} and cannot be confirmed again.`,
      'INVALID_STATE',
    )
  }

  if (
    !payment.confirmationTokenHash ||
    !constantTimeEquals(payment.confirmationTokenHash, hashToken(input.token))
  ) {
    throw new PaymentError('That confirmation is no longer valid. Start the payment again.', 'BAD_CONFIRMATION')
  }

  const provider = getPaymentProvider()

  if (!provider.supportsPaymentInitiation) {
    // Recorded for tracking, explicitly not submitted anywhere. The status stays
    // DRAFT so nothing in the UI can read it as money in flight.
    const tracked = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'DRAFT',
        confirmationTokenHash: null,
        confirmedAt: new Date(),
        confirmedByUserId: input.scope.userId,
        failureReason: 'No payment provider configured; recorded for tracking only.',
      },
    })

    await recordAuditSafe({
      action: AUDIT_ACTIONS.paymentConfirmed,
      workspaceId: input.scope.workspaceId,
      userId: input.scope.userId,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { outcome: 'tracking-only', amount: payment.amount.toFixed(2) },
      ...(input.context ? { context: input.context } : {}),
    })

    throw new PaymentInitiationUnavailableError()
  }

  let result
  try {
    result = await provider.schedulePayment({
      idempotencyKey: payment.id,
      fundingAccountProviderId: payment.fundingAccount.providerAccountId,
      payeeName: payment.payeeName,
      amount: payment.amount.toFixed(2),
      scheduledFor: payment.scheduledFor,
      memo: payment.memo,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment provider rejected the request'

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: message, confirmationTokenHash: null },
    })

    await recordAuditSafe({
      action: AUDIT_ACTIONS.paymentFailed,
      workspaceId: input.scope.workspaceId,
      userId: input.scope.userId,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { message },
      ...(input.context ? { context: input.context } : {}),
    })

    throw new PaymentError(message, 'PROVIDER_UNAVAILABLE')
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: result.status,
      providerPaymentId: result.providerPaymentId,
      confirmedAt: new Date(),
      confirmedByUserId: input.scope.userId,
      // Burned: the token cannot be replayed.
      confirmationTokenHash: null,
      ...(result.status === 'SUBMITTED' ? { submittedAt: new Date() } : {}),
    },
  })

  await recordAuditSafe({
    action:
      result.status === 'SCHEDULED' ? AUDIT_ACTIONS.paymentScheduled : AUDIT_ACTIONS.paymentSubmitted,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'payment',
    resourceId: payment.id,
    metadata: {
      amount: payment.amount.toFixed(2),
      payee: payment.payeeName,
      providerPaymentId: result.providerPaymentId,
      status: result.status,
    },
    ...(input.context ? { context: input.context } : {}),
  })

  return updated
}

/**
 * Provider confirmation. This is the only function that can set COMPLETED, and
 * it is the only place a bill occurrence is marked paid as a result of a
 * payment — matching the rule that the dashboard never implies a bill was paid
 * until the provider says it was.
 */
export async function settlePayment(input: {
  providerPaymentId: string
  status: Extract<PaymentStatus, 'COMPLETED' | 'FAILED' | 'PROCESSING'>
  failureReason?: string
}): Promise<void> {
  const payment = await prisma.payment.findFirst({
    where: { providerPaymentId: input.providerPaymentId },
  })
  if (!payment) return

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: input.status,
        ...(input.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      },
    })

    if (input.status === 'COMPLETED' && payment.billOccurrenceId) {
      await tx.billOccurrence.update({
        where: { id: payment.billOccurrenceId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paidAmount: payment.amount,
          paidSource: 'payment-confirmed',
        },
      })
    }
  })

  await recordAuditSafe({
    action:
      input.status === 'COMPLETED' ? AUDIT_ACTIONS.paymentCompleted : AUDIT_ACTIONS.paymentFailed,
    workspaceId: payment.workspaceId,
    resourceType: 'payment',
    resourceId: payment.id,
    metadata: { status: input.status, providerPaymentId: input.providerPaymentId },
  })
}

export async function cancelPayment(input: {
  scope: WorkspaceScope
  paymentId: string
  context?: RequestContext
}) {
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, workspaceId: input.scope.workspaceId },
  })
  if (!payment) throw new PaymentError('Payment not found.', 'ACCOUNT_NOT_FOUND')

  const cancellable: PaymentStatus[] = ['DRAFT', 'PENDING_CONFIRMATION', 'SCHEDULED']
  if (!cancellable.includes(payment.status)) {
    throw new PaymentError(
      `A ${payment.status.toLowerCase().replace('_', ' ')} payment can no longer be cancelled.`,
      'INVALID_STATE',
    )
  }

  if (payment.providerPaymentId) {
    await getPaymentProvider().cancelPayment(payment.providerPaymentId)
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'CANCELLED', confirmationTokenHash: null },
  })

  await recordAuditSafe({
    action: AUDIT_ACTIONS.paymentCancelled,
    workspaceId: input.scope.workspaceId,
    userId: input.scope.userId,
    resourceType: 'payment',
    resourceId: payment.id,
    metadata: { amount: payment.amount.toFixed(2), previousStatus: payment.status },
    ...(input.context ? { context: input.context } : {}),
  })

  return updated
}

export async function listPayments(
  scope: WorkspaceScope,
  filter?: {
    ledger?: 'PERSONAL' | 'BUSINESS'
    entityId?: string
    status?: PaymentStatus
    from?: Date
    to?: Date
  },
) {
  return prisma.payment.findMany({
    where: {
      workspaceId: scope.workspaceId,
      ...(filter?.ledger ? { ledger: filter.ledger } : {}),
      ...(filter?.entityId ? { entityId: filter.entityId } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.from || filter?.to
        ? {
            scheduledFor: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    include: {
      entity: { select: { id: true, name: true, ledger: true, color: true } },
      fundingAccount: { select: { id: true, name: true, mask: true, institutionName: true } },
      occurrence: { include: { bill: { select: { id: true, name: true } } } },
      confirmedBy: { select: { name: true, email: true } },
    },
    orderBy: { scheduledFor: 'desc' },
    take: 200,
  })
}
