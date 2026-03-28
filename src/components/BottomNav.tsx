'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/library', label: 'Library', emoji: null, isLogo: true },
  { href: '/search', label: 'Search', emoji: '🔍', isLogo: false },
  { href: '/stats', label: 'Stats', emoji: '📊', isLogo: false },
  { href: '/settings', label: 'Settings', emoji: '⚙️', isLogo: false },
]

export default function BottomNav() {
  const pathname = usePathname()

  // Don't show on auth pages
  if (pathname.startsWith('/auth')) return null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur border-t border-slate-800 sm:hidden">
      <div className="flex items-stretch h-16">
        {tabs.map(tab => {
          const active = pathname === tab.href || (tab.href !== '/' && pathname.startsWith(tab.href + '/'))
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-amber-400' : 'text-slate-500'
              }`}
            >
              {tab.isLogo ? (
                <img src="/logo.png" alt="Library" className="w-6 h-6 rounded-md" />
              ) : (
                <span className="text-xl leading-none">{tab.emoji}</span>
              )}
              <span className="text-xs font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
