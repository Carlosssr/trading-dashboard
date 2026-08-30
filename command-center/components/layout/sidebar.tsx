'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Banknote,
  Building2,
  CreditCard,
  Gauge,
  Home,
  Landmark,
  LineChart,
  PieChart,
  Receipt,
  Settings,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Primary navigation. Links carry the current filter query string forward, so
 * moving from Dashboard to Debt keeps the ledger, entity, and period the user
 * had selected rather than silently resetting to defaults.
 */

const NAV = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/accounts', label: 'Accounts', icon: Wallet },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
  { href: '/credit-cards', label: 'Credit Cards', icon: CreditCard },
  { href: '/debt', label: 'Debt', icon: Gauge },
  { href: '/bills', label: 'Bills', icon: Banknote },
  { href: '/real-estate', label: 'Real Estate', icon: Landmark },
  { href: '/business', label: 'Business', icon: Building2 },
  { href: '/investments', label: 'Investments', icon: LineChart },
  { href: '/reports', label: 'Reports', icon: PieChart },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const

export function Sidebar({ workspaceName, userName }: { workspaceName: string; userName: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const suffix = query ? `?${query}` : ''

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-56 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="border-b border-line px-4 py-4">
        <p className="text-[13px] font-semibold tracking-tight text-primary">Command Center</p>
        <p className="mt-0.5 truncate text-xs text-muted">{workspaceName}</p>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <li key={item.href}>
              <Link
                href={`${item.href}${suffix}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                  active
                    ? 'bg-accent-soft font-medium text-[var(--accent-ink)]'
                    : 'text-secondary hover:bg-sunken hover:text-primary',
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <p className="truncate text-xs font-medium text-primary">{userName}</p>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="mt-1 text-xs text-muted underline-offset-2 hover:text-primary hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
