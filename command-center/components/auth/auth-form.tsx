'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Shared shell for the sign-in, sign-up, and MFA forms: posts JSON to an auth
 * endpoint, surfaces the server's message, and navigates on success.
 *
 * Errors are shown exactly as the server phrased them. The login endpoint
 * deliberately returns the same message for an unknown address and a wrong
 * password, and this component must not embellish that into something that
 * distinguishes the two.
 */
export function AuthForm({
  endpoint,
  submitLabel,
  onSuccess,
  children,
  values,
  footer,
}: {
  endpoint: string
  submitLabel: string
  onSuccess: (data: { mfaRequired?: boolean }) => string
  children: ReactNode
  values: () => Record<string, string>
  footer?: ReactNode
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values()),
      })

      const data = (await response.json()) as { error?: { message: string }; mfaRequired?: boolean }

      if (!response.ok) {
        setError(data.error?.message ?? 'Something went wrong.')
        setPending(false)
        return
      }

      router.push(onSuccess(data))
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <div className="space-y-4">{children}</div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-critical-soft px-3 py-2 text-xs text-[var(--delta-down)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={cn(
          'mt-5 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity',
          pending && 'opacity-60',
        )}
      >
        {pending ? 'Working…' : submitLabel}
      </button>

      {footer ? <div className="mt-4 text-center text-xs text-muted">{footer}</div> : null}
    </form>
  )
}

export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  autoComplete,
  hint,
  required = true,
  inputMode,
}: {
  label: string
  name: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  hint?: string
  required?: boolean
  inputMode?: 'numeric' | 'text' | 'email'
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-secondary">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-primary placeholder:text-muted"
      />
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  )
}
