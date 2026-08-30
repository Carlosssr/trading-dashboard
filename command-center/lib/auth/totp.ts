import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP per RFC 6238 (HMAC-SHA1, 6 digits, 30-second step) — the algorithm every
 * authenticator app implements. Roughly forty lines, so it lives here rather
 * than as a dependency in the authentication path.
 */

const DIGITS = 6
const STEP_SECONDS = 30
/** Accept the neighbouring steps to tolerate clock skew. */
const DRIFT_STEPS = 1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function codeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const counterBuffer = Buffer.alloc(8)
  // Counters stay well inside 2^53, so a BigInt round-trip buys nothing here.
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  counterBuffer.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

export function generateCode(secret: string, at: Date = new Date()): string {
  return codeForCounter(secret, Math.floor(at.getTime() / 1000 / STEP_SECONDS))
}

export function verifyCode(secret: string, submitted: string, at: Date = new Date()): boolean {
  const candidate = submitted.replace(/\s/g, '')
  if (!/^\d{6}$/.test(candidate)) return false

  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS)
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const expected = codeForCounter(secret, counter + drift)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true
  }
  return false
}

export function otpauthUri(secret: string, account: string, issuer = 'Financial Command Center'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params}`
}

/** Ten single-use recovery codes, formatted for legibility. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase()
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
  })
}
