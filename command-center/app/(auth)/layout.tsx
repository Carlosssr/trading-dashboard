export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-primary">Financial Command Center</h1>
          <p className="mt-1 text-xs text-muted">
            Personal and business finances in one view, kept separate underneath.
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
