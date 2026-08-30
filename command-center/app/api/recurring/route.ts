import { NextResponse } from 'next/server'
import { requireScope } from '@/lib/auth/guards'
import { listRecurring } from '@/lib/services/recurring'
import { handleApiError } from '@/lib/api'

export async function GET(request: Request) {
  try {
    const scope = await requireScope('read')
    const status = new URL(request.url).searchParams.get('status')

    const series = await listRecurring(scope, {
      ...(status === 'DETECTED' || status === 'CONFIRMED' || status === 'IGNORED' ? { status } : {}),
      includeIncome: true,
    })

    return NextResponse.json({
      series: series.map((item) => ({
        id: item.id,
        merchantName: item.merchantName,
        cadence: item.cadence,
        averageAmount: item.averageAmount.toFixed(2),
        lastAmount: item.lastAmount.toFixed(2),
        confidence: item.confidence,
        occurrenceCount: item.occurrenceCount,
        status: item.status,
        isIncome: item.isIncome,
        nextExpectedAt: item.nextExpectedAt,
        categoryName: item.category?.name ?? null,
        accountName: item.account?.name ?? null,
        entityName: item.entity.name,
        billCount: item._count.bills,
      })),
    })
  } catch (error) {
    return handleApiError(error)
  }
}
