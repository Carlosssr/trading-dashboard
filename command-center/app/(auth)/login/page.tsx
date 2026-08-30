'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthForm, Field } from '@/components/auth/auth-form'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <AuthForm
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      values={() => ({ email, password })}
      onSuccess={(data) => (data.mfaRequired ? '/mfa' : '/')}
      footer={
        <>
          No account yet?{' '}
          <Link href="/register" className="text-accent hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <Field
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
    </AuthForm>
  )
}
