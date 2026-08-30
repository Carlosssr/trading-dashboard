import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireScope } from '@/lib/auth/guards'
import { queryTransactions } from '@/lib/services/transactions'
import { handleApiError } from '@/lib/api'

const schema = z.object({
  ledger: z.enum(['PERSONAL', 'BUSINESS']).optional(),
  entityId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(200).optional(),
  uncategorizedOnly: z.enum(['0', '1']).optional(),
  recurringOnly: z.enum(['0', '1']).optional(),
  includeTransfers: z.enum(['0', '1']).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
})

export async function GET(request: Request) {
  try {
    const scope = await requireScope('read')
    const url = new URL(request.url)
    const params = schema.parse(Object.fromEntries(url.searchParams))

    const page = await queryTransactions(
      scope,
      {
        ...(params.ledger ? { ledger: params.ledger } : {}),
        ...(params.entityId ? { entityId: params.entityId } : {}),
        ...(params.accountId ? { accountId: params.accountId } : {}),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
        ...(params.from ? { from: new Date(params.from) } : {}),
        ...(params.to ? { to: new Date(params.to) } : {}),
        ...(params.q ? { search: params.q } : {}),
        uncategorizedOnly: params.uncategorizedOnly === '1',
        recurringOnly: params.recurringOnly === '1',
        includeTransfers: params.includeTransfers === '1',
      },
      {
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      },
    )

    // Shaped explicitly rather than returned raw, so a column added to the model
    // later cannot leak into an API response by accident.
    return NextResponse.json({
      total: page.total,
      nextCursor: page.nextCursor,
      transactions: page.transactions.map((transaction) => ({
        id: transaction.id,
        postedAt: transaction.postedAt,
        amount: transaction.amount.toFixed(2),
        merchantName: transaction.merchantName,
        rawName: transaction.rawName,
        categoryId: transaction.categoryId,
        categoryName: transaction.category?.name ?? null,
        ledger: transaction.ledger,
        entityId: transaction.entityId,
        entityName: transaction.entity.name,
        accountId: transaction.accountId,
        accountName: transaction.account.name,
        isRecurring: transaction.isRecurring,
        isTransfer: transaction.isTransfer,
        pending: transaction.pending,
        notes: transaction.notes,
      })),
    })
  } catch (error) {
    return handleApiError(error)
  }
}
