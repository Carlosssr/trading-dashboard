'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AuthForm, Field } from '@/components/auth/auth-form'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')

  return (
    <AuthForm
      endpoint="/api/auth/register"
      submitLabel="Create account"
      values={() => ({ name, email, password, workspaceName })}
      onSuccess={() => '/settings/connections'}
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <Field label="Your name" name="name" autoComplete="name" value={name} onChange={setName} />
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
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        hint="At least 12 characters, with upper and lower case and a number."
      />
      <Field
        label="Workspace name"
        name="workspaceName"
        required={false}
        value={workspaceName}
        onChange={setWorkspaceName}
        hint="Optional. You can rename it later."
      />
    </AuthForm>
  )
}
