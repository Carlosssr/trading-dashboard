import { NextResponse } from 'next/server'
import { requireScope } from '@/lib/auth/guards'
import { requestContext } from '@/lib/auth/session'
import { unlinkItem } from '@/lib/services/linking'
import { handleApiError } from '@/lib/api'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireScope('linkInstitution')
    const context = await requestContext()
    const { id } = await params

    await unlinkItem({ scope, itemId: id, context })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
