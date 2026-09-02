'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Profile {
  audible_refresh_token: string | null
  audible_locale: string | null
  last_synced_at: string | null
  last_releases_synced_at?: string | null
}

export default function SettingsPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncElapsed, setSyncElapsed] = useState(0)

  const [refreshingReleases, setRefreshingReleases] = useState(false)
  const [releasesMsg, setReleasesMsg] = useState<string | null>(null)
  const [releasesError, setReleasesError] = useState<string | null>(null)
  const [releasesElapsed, setReleasesElapsed] = useState(0)

  const profileSelect =
    'audible_refresh_token, audible_locale, last_synced_at, last_releases_synced_at'

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/auth/login')
        return
      }
      setEmail(user.email ?? null)
      supabase
        .from('user_profiles')
        .select(profileSelect)
        .eq('id', user.id)
        .single()
        .then(({ data, error }) => {
          if (error) {
            // Column may not exist until migration 003 — fall back
            supabase
              .from('user_profiles')
              .select('audible_refresh_token, audible_locale, last_synced_at')
              .eq('id', user.id)
              .single()
              .then(({ data: d2 }) => {
                setProfile(d2)
                setLoading(false)
              })
          } else {
            setProfile(data)
            setLoading(false)
          }
        })
    })
  }, [router])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  async function refreshProfile() {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const full = await supabase
      .from('user_profiles')
      .select(profileSelect)
      .eq('id', user.id)
      .single()
    if (full.error) {
      const base = await supabase
        .from('user_profiles')
        .select('audible_refresh_token, audible_locale, last_synced_at')
        .eq('id', user.id)
        .single()
      setProfile(base.data)
      return base.data
    }
    setProfile(full.data)
    return full.data
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    setSyncError(null)
    setSyncElapsed(0)

    const startedAt = Date.now()
    const tickInterval = setInterval(() => {
      setSyncElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    // Sync runs as a long server request (up to ~5 min for a full library).
    // Mobile browsers/networks can drop the connection before the fetch
    // resolves even though the server-side job completes successfully.
    // If that happens, poll last_synced_at so the UI still reflects reality
    // instead of hanging on "Syncing..." forever.
    const priorLastSynced = profile?.last_synced_at ?? null

    try {
      const res = await fetch('/api/audible/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (res.ok) {
        setSyncMsg(`Synced ${data.books_synced ?? 0} books`)
        await refreshProfile()
      } else {
        setSyncError(data.error ?? 'Sync failed')
      }
    } catch {
      // Fetch itself failed/dropped client-side — the server job may still be
      // running or may have already finished. Poll last_synced_at for up to
      // ~6 minutes (longer than the server's own 5-minute max) before giving
      // up and telling the user to check back manually.
      setSyncError(null)
      const pollStart = Date.now()
      const maxPollMs = 6 * 60 * 1000
      let resolved = false
      while (Date.now() - pollStart < maxPollMs) {
        await new Promise((r) => setTimeout(r, 5000))
        const updated = await refreshProfile()
        if (updated?.last_synced_at && updated.last_synced_at !== priorLastSynced) {
          setSyncMsg(
            'Sync completed — connection dropped before confirmation, but your library is up to date'
          )
          resolved = true
          break
        }
      }
      if (!resolved) {
        setSyncError(
          'Lost connection to the sync — check back in a few minutes, or try again'
        )
      }
    } finally {
      clearInterval(tickInterval)
      setSyncing(false)
      setSyncElapsed(0)
    }
  }

  async function handleRefreshReleases(force = true) {
    setRefreshingReleases(true)
    setReleasesMsg(null)
    setReleasesError(null)
    setReleasesElapsed(0)

    const startedAt = Date.now()
    const tickInterval = setInterval(() => {
      setReleasesElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    try {
      const url = force
        ? '/api/audible/releases?force=1'
        : '/api/audible/releases'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) {
        setReleasesError(data.error ?? 'Release refresh failed')
      } else if (data.skipped) {
        setReleasesMsg(
          data.message ||
            'Already refreshed this week — force-run if you want a fresh pull.'
        )
      } else {
        setReleasesMsg(
          `Found ${data.upserted ?? 0} releases · ${data.series_followed ?? 0} series followed · ${data.authors_searched ?? 0} authors scanned`
        )
        await refreshProfile()
      }
    } catch (e) {
      setReleasesError(
        e instanceof Error
          ? e.message
          : 'Lost connection during release refresh — try again'
      )
    } finally {
      clearInterval(tickInterval)
      setRefreshingReleases(false)
      setReleasesElapsed(0)
    }
  }

  const isConnected = !!profile?.audible_refresh_token
  const lastSynced = profile?.last_synced_at
    ? new Date(profile.last_synced_at).toLocaleString()
    : 'Never'
  const lastReleases = profile?.last_releases_synced_at
    ? new Date(profile.last_releases_synced_at).toLocaleString()
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
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Your Account
          </h2>
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
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Audible
          </h2>
        </div>
        <div className="px-5 py-4 space-y-4">
          {isConnected ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-semibold">Connected ✅</span>
                {profile?.audible_locale && (
                  <span className="text-slate-500 text-sm">
                    ({profile.audible_locale.toUpperCase()})
                  </span>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Library last synced</div>
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
                disabled={syncing || refreshingReleases}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {syncing
                  ? `⏳ Syncing library… ${syncElapsed}s`
                  : '🔄 Sync Library Now'}
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

      {/* Upcoming releases catalog */}
      {isConnected && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Upcoming Releases
            </h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            <p className="text-slate-400 text-sm">
              Pulls preorders and new titles from Audible&apos;s catalog for series
              you&apos;re actively reading and authors you&apos;ve marked read. Runs
              separately from library sync (weekly is enough — this data changes slowly).
            </p>
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Catalog last refreshed</div>
              <div className="text-amber-50 text-sm">{lastReleases}</div>
            </div>
            {releasesMsg && (
              <div className="text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2">
                ✓ {releasesMsg}
              </div>
            )}
            {releasesError && (
              <div className="text-sm text-red-300 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
                {releasesError}
              </div>
            )}
            <button
              onClick={() => handleRefreshReleases(true)}
              disabled={refreshingReleases || syncing}
              className="w-full py-2.5 px-4 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {refreshingReleases
                ? `⏳ Refreshing catalog… ${releasesElapsed}s`
                : '📅 Refresh Releases'}
            </button>
            <Link
              href="/upcoming"
              className="block text-center text-sm text-amber-500 hover:text-amber-400"
            >
              View Upcoming page →
            </Link>
          </div>
        </section>
      )}

      {/* App */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            App
          </h2>
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
