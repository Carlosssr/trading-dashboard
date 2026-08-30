'use client'

import { useState } from 'react'
import { AuthForm, Field } from '@/components/auth/auth-form'

export default function MfaPage() {
  const [code, setCode] = useState('')

  return (
    <AuthForm
      endpoint="/api/auth/mfa/challenge"
      submitLabel="Verify"
      values={() => ({ code })}
      onSuccess={() => '/'}
      footer="Lost your authenticator? Enter one of your backup codes instead."
    >
      <Field
        label="Authentication code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={setCode}
        hint="Six digits from your authenticator app."
      />
    </AuthForm>
  )
}
