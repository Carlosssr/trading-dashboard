import 'server-only'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

// promisify resolves to the overload without options, so the signature is
// restated here to keep the tuning parameters below type-checked.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

/**
 * scrypt via Node's built-in crypto: no native build step and no third-party
 * dependency anywhere in the credential path.
 *
 * N=2^15 with r=8 needs roughly 32 MB per hash, which is why maxmem is raised
 * from the 32 MB default that would otherwise reject these parameters.
 */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const KEY_BYTES = 64
const SALT_BYTES = 16

export type PasswordHash = { hash: string; salt: string }

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES)
  const derived = (await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, PARAMS)) as Buffer
  return { hash: derived.toString('base64'), salt: salt.toString('base64') }
}

export async function verifyPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'base64')
  const derived = (await scrypt(
    password.normalize('NFKC'),
    Buffer.from(stored.salt, 'base64'),
    expected.length || KEY_BYTES,
    PARAMS,
  )) as Buffer

  if (expected.length !== derived.length) return false
  return timingSafeEqual(expected, derived)
}

/**
 * Burns the same CPU as a real verification so that a login attempt for an
 * address with no account is indistinguishable, by timing, from a wrong
 * password on an address that exists.
 */
export async function fakeVerify(password: string): Promise<void> {
  await scrypt(password.normalize('NFKC'), randomBytes(SALT_BYTES), KEY_BYTES, PARAMS)
}

export type PasswordProblem = string

export function validatePasswordStrength(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = []
  if (password.length < 12) problems.push('Must be at least 12 characters.')
  if (!/[a-z]/.test(password)) problems.push('Must include a lowercase letter.')
  if (!/[A-Z]/.test(password)) problems.push('Must include an uppercase letter.')
  if (!/[0-9]/.test(password)) problems.push('Must include a number.')
  return problems
}
