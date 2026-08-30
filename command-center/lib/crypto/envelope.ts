import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * AES-256-GCM envelope encryption for the two things we hold that would be
 * dangerous in plaintext: aggregation-provider access tokens and TOTP secrets.
 *
 * Every sealed value carries a key version so keys can be rotated by re-sealing
 * rows with a new version rather than taking the application down.
 *
 * The `context` argument becomes additional authenticated data, which binds a
 * ciphertext to the kind of record it came from. A provider token lifted out of
 * ProviderItem and pasted into User.mfaSecret fails to open.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

export type SealedValue = {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: number
}

export type EncryptionContext = 'provider-access-token' | 'mfa-secret'

function keyForVersion(version: number): Buffer {
  // A real rotation setup reads historical keys from a secret manager keyed by
  // version. Locally there is one key; requesting an older version is a
  // configuration error, not something to paper over with a silent fallback.
  if (version !== env.encryptionKeyVersion) {
    throw new Error(
      `No encryption key available for version ${version} (current is ${env.encryptionKeyVersion}). ` +
        'Provide the historical key before reading records sealed with it.',
    )
  }
  const key = Buffer.from(env.encryptionKey, 'base64')
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`)
  }
  return key
}

export function seal(plaintext: string, context: EncryptionContext): SealedValue {
  const version = env.encryptionKeyVersion
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyForVersion(version), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: version,
  }
}

export function open(sealed: SealedValue, context: EncryptionContext): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    keyForVersion(sealed.keyVersion),
    Buffer.from(sealed.iv, 'base64'),
  )
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** SHA-256, salted with SESSION_SECRET. Used for session and backup-code lookup. */
export function hashToken(token: string): string {
  return createHash('sha256').update(`${env.sessionSecret}:${token}`).digest('hex')
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
