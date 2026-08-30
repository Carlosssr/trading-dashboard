import { NextResponse } from 'next/server'
import { requireScope } from '@/lib/auth/guards'
import { createLinkSession } from '@/lib/services/linking'
import { handleApiError } from '@/lib/api'

/**
 * Creates the provider link session. The response carries a short-lived link
 * token for the provider's browser SDK — never an access token and never a
 * provider API key.
 */
export async function POST() {
  try {
    const scope = await requireScope('linkInstitution')
    const session = await createLinkSession(scope)

    return NextResponse.json({
      linkToken: session.linkToken,
      expiration: session.expiration,
      provider: session.provider,
      availableInstitutions: session.availableInstitutions ?? null,
    })
  } catch (error) {
    return handleApiError(error)
  }
}
