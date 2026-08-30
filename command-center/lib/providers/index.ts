import 'server-only'
import { env } from '@/lib/env'
import type { AggregationProvider } from './types'
import { DemoProvider } from './demo'
import { PlaidProvider } from './plaid'

/**
 * Provider selection. This is the only place the application decides which
 * aggregator it is talking to; everything else takes an `AggregationProvider`.
 *
 * Adding MX or Finicity means writing an adapter and adding a case here.
 *
 * The Plaid adapter builds its API client lazily inside each method, so
 * importing it here costs nothing and demands no credentials when the demo
 * provider is the one selected.
 */

let cached: AggregationProvider | null = null

export function getAggregationProvider(): AggregationProvider {
  if (cached) return cached
  cached = env.aggregationProvider === 'plaid' ? new PlaidProvider() : new DemoProvider()
  return cached
}

export type { AggregationProvider } from './types'
export { ProviderError } from './types'
