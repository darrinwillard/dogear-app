'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navLinks = [
  { href: '/', label: 'Dashboard', emoji: '📊' },
  { href: '/library', label: 'Library', emoji: '📚' },
  { href: '/series', label: 'Series', emoji: '🔖' },
  { href: '/upcoming', label: 'Upcoming', emoji: '📅' },
  { href: '/settings', label: 'Settings', emoji: '⚙️' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <nav className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-2xl">🐾</span>
            <span className="font-serif text-xl font-bold text-amber-400 group-hover:text-amber-300 transition-colors">
              DogEar
            </span>
          </Link>

          {/* Nav links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map(link => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                  }`}
                >
                  <span>{link.emoji}</span>
                  <span>{link.label}</span>
                </Link>
              )
            })}
          </div>

          {/* Mobile nav */}
          <div className="flex sm:hidden items-center gap-1">
            {navLinks.map(link => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center px-2 py-1.5 rounded text-lg transition-all ${
                    active ? 'text-amber-400' : 'text-slate-500'
                  }`}
                  title={link.label}
                >
                  {link.emoji}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
