import 'server-only'
import type { PaymentStatus, ProviderName } from '@prisma/client'
import { env } from '@/lib/env'

/**
 * Payment initiation boundary.
 *
 * Deliberately separate from the aggregation provider: reading balances and
 * moving money are different permissions, usually different products, and often
 * different vendors. Keeping them apart means an aggregation-only deployment
 * cannot accidentally acquire the ability to send money.
 *
 * No real money-movement provider ships in this MVP. The default implementation
 * refuses, loudly, so nothing can quietly appear to have been paid.
 */

export type SchedulePaymentInput = {
  idempotencyKey: string
  fundingAccountProviderId: string | null
  payeeName: string
  amount: string
  scheduledFor: Date
  memo?: string | null
}

export type SchedulePaymentResult = {
  providerPaymentId: string
  status: PaymentStatus
}

export interface PaymentProvider {
  readonly name: ProviderName
  readonly supportsPaymentInitiation: boolean
  schedulePayment(input: SchedulePaymentInput): Promise<SchedulePaymentResult>
  cancelPayment(providerPaymentId: string): Promise<void>
}

export class PaymentInitiationUnavailableError extends Error {
  constructor() {
    super(
      'Payment initiation is not configured. Bills can be tracked and marked paid, but this ' +
        'deployment cannot move money until a payment provider is connected.',
    )
    this.name = 'PaymentInitiationUnavailableError'
  }
}

/** The honest default: tracking works, initiation refuses. */
class UnavailablePaymentProvider implements PaymentProvider {
  readonly name: ProviderName = 'MANUAL'
  readonly supportsPaymentInitiation = false

  async schedulePayment(): Promise<SchedulePaymentResult> {
    throw new PaymentInitiationUnavailableError()
  }

  async cancelPayment(): Promise<void> {
    throw new PaymentInitiationUnavailableError()
  }
}

/**
 * Simulated rail for the demo environment. It accepts a payment and reports it
 * as SUBMITTED — never COMPLETED. Completion still has to arrive through
 * `settlePayment`, which is the same path a real provider webhook would take, so
 * the "only a provider confirmation marks a payment complete" rule is exercised
 * rather than bypassed.
 */
class DemoPaymentProvider implements PaymentProvider {
  readonly name: ProviderName = 'DEMO'
  readonly supportsPaymentInitiation = true

  async schedulePayment(input: SchedulePaymentInput): Promise<SchedulePaymentResult> {
    return {
      providerPaymentId: `demo-pay-${input.idempotencyKey}`,
      status: input.scheduledFor > new Date() ? 'SCHEDULED' : 'SUBMITTED',
    }
  }

  async cancelPayment(): Promise<void> {
    // Nothing to cancel upstream in the simulated rail.
  }
}

let cached: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached
  cached = env.aggregationProvider === 'demo' ? new DemoPaymentProvider() : new UnavailablePaymentProvider()
  return cached
}
