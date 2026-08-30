import { NextResponse } from 'next/server'
import { getSession, revokeCurrentSession, requestContext } from '@/lib/auth/session'
import { AUDIT_ACTIONS, recordAuditSafe } from '@/lib/services/audit'
import { handleApiError } from '@/lib/api'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const context = await requestContext()

    await revokeCurrentSession()

    if (session) {
      await recordAuditSafe({
        action: AUDIT_ACTIONS.logout,
        userId: session.userId,
        workspaceId: session.workspaceId,
        context,
      })
    }

    // The sidebar posts a plain form, so a redirect is the right response there;
    // a fetch caller gets JSON.
    if (request.headers.get('accept')?.includes('text/html')) {
      return NextResponse.redirect(new URL('/login', request.url), 303)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}
