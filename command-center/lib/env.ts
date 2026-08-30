import 'server-only'

/**
 * Server-side environment access. Importing this module from a client component
 * is a build error (`server-only`), which is the first line of defence against a
 * provider secret being bundled into browser JavaScript.
 */

/** Provider secrets that must never be exposed to the browser. */
const SERVER_ONLY_KEYS = [
  'PLAID_CLIENT_ID',
  'PLAID_SECRET',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'DATABASE_URL',
] as const

/**
 * Next.js inlines any variable prefixed with NEXT_PUBLIC_ into the client
 * bundle. If someone ever adds one for a secret, fail loudly at startup rather
 * than shipping it to every visitor.
 */
function assertNoPublicSecrets(): void {
  const leaked = SERVER_ONLY_KEYS.filter((key) => process.env[`NEXT_PUBLIC_${key}`] !== undefined)
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to start: ${leaked
        .map((k) => `NEXT_PUBLIC_${k}`)
        .join(', ')} would be inlined into the client bundle. Remove the NEXT_PUBLIC_ prefix.`,
    )
  }
}

function required(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback
}

assertNoPublicSecrets()

export type AggregationProviderName = 'demo' | 'plaid'

const providerName = optional('AGGREGATION_PROVIDER', 'demo').toLowerCase()
if (providerName !== 'demo' && providerName !== 'plaid') {
  throw new Error(`AGGREGATION_PROVIDER must be "demo" or "plaid", got "${providerName}"`)
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  isProduction: process.env.NODE_ENV === 'production',

  encryptionKey: required('ENCRYPTION_KEY'),
  encryptionKeyVersion: Number(optional('ENCRYPTION_KEY_VERSION', '1')),
  sessionSecret: required('SESSION_SECRET'),

  aggregationProvider: providerName as AggregationProviderName,

  plaid: {
    clientId: optional('PLAID_CLIENT_ID'),
    secret: optional('PLAID_SECRET'),
    environment: optional('PLAID_ENV', 'sandbox'),
    webhookUrl: optional('PLAID_WEBHOOK_URL'),
  },
} as const

if (env.aggregationProvider === 'plaid' && (!env.plaid.clientId || !env.plaid.secret)) {
  throw new Error(
    'AGGREGATION_PROVIDER=plaid requires PLAID_CLIENT_ID and PLAID_SECRET. ' +
      'Use AGGREGATION_PROVIDER=demo to run without provider credentials.',
  )
}
