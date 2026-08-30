import { NextResponse, type NextRequest } from 'next/server'

/**
 * Content-Security-Policy with a per-request nonce.
 *
 * Next.js emits inline bootstrap scripts, so a policy without either a nonce or
 * `unsafe-inline` blocks hydration outright — the page renders and then does
 * nothing. The nonce is the right answer rather than `unsafe-inline`: Next reads
 * it back off the request header and stamps it onto its own script tags, so
 * exactly those scripts run and an injected one still does not.
 *
 * `strict-dynamic` lets those trusted scripts load their own chunks without the
 * policy having to enumerate every bundle URL.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV !== 'production'

  const csp = [
    "default-src 'self'",
    // `unsafe-eval` is required by the development bundler only; it is absent
    // from production builds.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.plaid.com${
      isDev ? " 'unsafe-eval'" : ''
    }`,
    // Next and Recharts both inject style attributes at runtime, which no nonce
    // can cover; inline styles cannot execute script, so this is the narrow
    // concession.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.plaid.com",
    "frame-src 'self' https://cdn.plaid.com https://*.plaid.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // Next.js looks for the nonce on this request header.
  requestHeaders.set('content-security-policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = {
  matcher: [
    // Everything except static assets and the image optimizer, which serve no
    // scripts and would only pay the cost.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
