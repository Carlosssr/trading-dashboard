import { Suspense } from 'react'
import { requireSessionOrRedirect } from '@/lib/auth/guards'
import { Sidebar } from '@/components/layout/sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionOrRedirect()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Suspense because the sidebar reads search params to preserve filters across links. */}
      <Suspense fallback={<div className="w-56 shrink-0 border-r border-line bg-surface" />}>
        <Sidebar workspaceName={session.workspaceName} userName={session.name} />
      </Suspense>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
