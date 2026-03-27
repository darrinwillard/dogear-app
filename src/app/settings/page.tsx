'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Profile {
  audible_refresh_token: string | null
  audible_locale: string | null
  last_synced_at: string | null
}

export default function SettingsPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/auth/login'); return }
      setEmail(user.email ?? null)
      supabase
        .from('user_profiles')
        .select('audible_refresh_token, audible_locale, last_synced_at')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setProfile(data)
          setLoading(false)
        })
    })
  }, [router])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    setSyncError(null)
    try {
      const res = await fetch('/api/audible/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (res.ok) {
        setSyncMsg(`Synced ${data.books_synced ?? 0} books`)
        // Refresh profile to get updated last_synced_at
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: updated } = await supabase
            .from('user_profiles')
            .select('audible_refresh_token, audible_locale, last_synced_at')
            .eq('id', user.id)
            .single()
          setProfile(updated)
        }
      } else {
        setSyncError(data.error ?? 'Sync failed')
      }
    } catch {
      setSyncError('Sync failed — check your connection')
    } finally {
      setSyncing(false)
    }
  }

  const isConnected = !!profile?.audible_refresh_token
  const lastSynced = profile?.last_synced_at
    ? new Date(profile.last_synced_at).toLocaleString()
    : 'Never'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-slate-500">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="font-serif text-3xl font-bold text-amber-400">Settings</h1>

      {/* Account */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Account</h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-xs text-slate-500 mb-0.5">Email</div>
            <div className="text-amber-50">{email}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full py-2 px-4 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-amber-50 transition-colors text-sm font-medium"
          >
            Sign Out
          </button>
        </div>
      </section>

      {/* Audible */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Audible</h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-semibold">Connected ✅</span>
                {profile?.audible_locale && (
                  <span className="text-slate-500 text-sm">({profile.audible_locale.toUpperCase()})</span>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Last synced</div>
                <div className="text-amber-50 text-sm">{lastSynced}</div>
              </div>
              {syncMsg && (
                <div className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
                  ✓ {syncMsg}
                </div>
              )}
              {syncError && (
                <div className="text-sm text-red-300 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
                  {syncError}
                </div>
              )}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {syncing ? '⏳ Syncing...' : '🔄 Sync Now'}
              </button>
              <button
                onClick={() => router.push('/settings/connect-audible')}
                className="w-full py-2 px-4 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-300 hover:bg-slate-800 transition-colors text-sm"
              >
                Reconnect Audible
              </button>
            </>
          ) : (
            <>
              <p className="text-slate-400 text-sm">
                Connect your Audible account to sync your library automatically.
              </p>
              <Link
                href="/settings/connect-audible"
                className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-colors text-sm"
              >
                <span>🎧</span> Connect Audible Account
              </Link>
            </>
          )}
        </div>
      </section>

      {/* App */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">App</h2>
        </div>
        <div className="px-5 py-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Version</span>
            <span className="text-slate-300">1.0.0</span>
          </div>
        </div>
      </section>
    </div>
  )
}
