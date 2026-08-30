import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAggregationProvider } from '@/lib/providers'
import { syncItem } from '@/lib/services/sync'
import { AUDIT_ACTIONS, recordAuditSafe } from '@/lib/services/audit'

/**
 * Provider webhooks.
 *
 * Unauthenticated by design — the signature check *is* the authentication. An
 * unverified payload is dropped and logged, and never triggers a sync.
 */
export async function POST(request: Request) {
  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  const provider = getAggregationProvider()
  const event = await provider.parseWebhook({ body, headers })

  if (!event) {
    await recordAuditSafe({
      action: AUDIT_ACTIONS.webhookRejected,
      metadata: { reason: 'signature-verification-failed' },
    })
    // 202 rather than 4xx: a rejected webhook is not a retryable error for the
    // sender, and echoing "bad signature" back is free information for a prober.
    return NextResponse.json({ received: true }, { status: 202 })
  }

  if (!event.providerItemId) {
    return NextResponse.json({ received: true })
  }

  const item = await prisma.providerItem.findUnique({
    where: {
      provider_providerItemId: { provider: provider.name, providerItemId: event.providerItemId },
    },
    select: { id: true, workspaceId: true },
  })

  if (!item) return NextResponse.json({ received: true })

  if (event.kind === 'TRANSACTIONS_UPDATED') {
    // No user is present on a webhook, so the sync runs with an OWNER-level
    // scope bound to the item's own workspace and no acting user id.
    await syncItem({
      scope: { workspaceId: item.workspaceId, userId: '', role: 'OWNER' },
      itemId: item.id,
    })
  } else if (event.status) {
    await prisma.providerItem.update({
      where: { id: item.id },
      data: { status: event.status, lastError: event.message ?? null },
    })
  }

  return NextResponse.json({ received: true })
}
