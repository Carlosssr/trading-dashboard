import 'server-only'
import { addDays, subDays } from 'date-fns'
import { prisma } from '@/lib/db'

/**
 * Internal transfer pairing.
 *
 * Moving $2,000 from checking to a credit card produces two transactions: a
 * −2,000 outflow and a +2,000 inflow. Left alone they would read as $2,000 of
 * spending *and* $2,000 of income, inflating both sides of every report.
 *
 * A pair is two transactions in different accounts of the same workspace, with
 * equal and opposite amounts, within a few days of each other. Only the outflow
 * carries the pointer; the inflow is reachable through the reverse relation.
 */

/** Settlement window. Card payments commonly post a day or two apart. */
const WINDOW_DAYS = 4

export async function pairTransfers(workspaceId: string): Promise<number> {
  const candidates = await prisma.transaction.findMany({
    where: {
      workspaceId,
      isTransfer: false,
      transferPairId: null,
      pending: false,
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      postedAt: true,
      transferPairOf: { select: { id: true } },
    },
    orderBy: { postedAt: 'desc' },
    // Bounded so a first sync of a large history does not build an O(n²)
    // comparison over tens of thousands of rows in one pass. Later syncs walk
    // the remainder.
    take: 4000,
  })

  const outflows = candidates.filter((t) => t.amount.lessThan(0) && !t.transferPairOf)
  const inflows = candidates.filter((t) => t.amount.greaterThan(0) && !t.transferPairOf)

  // Index inflows by absolute amount so each outflow is a map lookup rather than
  // a scan of the whole set.
  const inflowsByAmount = new Map<string, typeof inflows>()
  for (const inflow of inflows) {
    const key = inflow.amount.toFixed(2)
    const bucket = inflowsByAmount.get(key)
    if (bucket) bucket.push(inflow)
    else inflowsByAmount.set(key, [inflow])
  }

  const claimed = new Set<string>()
  let paired = 0

  for (const outflow of outflows) {
    if (claimed.has(outflow.id)) continue

    const bucket = inflowsByAmount.get(outflow.amount.abs().toFixed(2))
    if (!bucket) continue

    const windowStart = subDays(outflow.postedAt, WINDOW_DAYS)
    const windowEnd = addDays(outflow.postedAt, WINDOW_DAYS)

    const match = bucket.find(
      (inflow) =>
        !claimed.has(inflow.id) &&
        inflow.accountId !== outflow.accountId &&
        inflow.postedAt >= windowStart &&
        inflow.postedAt <= windowEnd,
    )
    if (!match) continue

    claimed.add(outflow.id)
    claimed.add(match.id)

    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: outflow.id },
        data: { isTransfer: true, transferPairId: match.id },
      }),
      prisma.transaction.update({
        where: { id: match.id },
        data: { isTransfer: true },
      }),
    ])

    paired += 1
  }

  return paired
}
