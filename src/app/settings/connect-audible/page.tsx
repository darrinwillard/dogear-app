'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ConnectAudiblePage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [locale, setLocale] = useState('us')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // Redirect to login if not authenticated
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login')
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setStatus('Connecting to Amazon...')

    try {
      const connectRes = await fetch('/api/audible/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, locale }),
      })

      if (!connectRes.ok) {
        const data = await connectRes.json().catch(() => ({}))
        throw new Error(data.error ?? `Request failed (${connectRes.status})`)
      }

      setStatus('Connected! Redirecting to your library...')

      // Kick off sync in the background — don't await so we redirect immediately
      fetch('/api/audible/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        keepalive: true,
      }).catch(() => {})

      router.push('/library?syncing=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus(null)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🎧</div>
          <h1 className="text-2xl font-bold text-white">Connect Audible</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Sync your Audible library with DogEar
          </p>
        </div>

        {/* Privacy notice */}
        <div className="mb-6 p-4 rounded-xl bg-slate-800/50 border border-slate-700 flex gap-3">
          <div className="text-amber-400 mt-0.5">🔒</div>
          <div className="text-sm text-slate-300">
            <p className="font-medium text-white mb-1">Your credentials are private</p>
            <p>
              Your Amazon email and password go <strong>directly to Amazon&apos;s servers</strong> via
              the official Audible API. We never store your password — only the secure refresh
              token Amazon provides after authentication.
            </p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-8">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
              {error}
            </div>
          )}

          {status && (
            <div className="mb-5 p-3 rounded-lg bg-amber-900/20 border border-amber-800/50 text-amber-300 text-sm">
              {status}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Amazon email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                placeholder="your@amazon.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Amazon password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Audible region
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              >
                <option value="us">United States (audible.com)</option>
                <option value="uk">United Kingdom (audible.co.uk)</option>
                <option value="de">Germany (audible.de)</option>
                <option value="fr">France (audible.fr)</option>
                <option value="ca">Canada (audible.ca)</option>
                <option value="au">Australia (audible.com.au)</option>
                <option value="jp">Japan (audible.co.jp)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Connecting...' : 'Connect Audible'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Uses the open-source{' '}
          <span className="text-slate-400">audible-api</span> library.
          Your credentials are transmitted over HTTPS and never logged.
        </p>
      </div>
    </div>
  )
}
