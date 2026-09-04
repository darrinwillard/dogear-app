'use client'

import { useEffect, useState } from 'react'
import type { SeriesGap, AuthorGap } from '@/lib/books/gaps'
import GapBookCard from './GapBookCard'

interface GapsResponse {
  seriesGaps: SeriesGap[]
  authorGaps: AuthorGap[]
  scannedAt: string | null
  error?: string
}

/**
 * "Series You're Reading" / "Other Books from Authors You've Read" tab.
 *
 * Loads PERSISTED results on mount (instant, no Audible calls) — fixes
 * Darrin's 2026-09-03 report that scan results disappeared when he came
 * back to the app later. A manual "Scan for New Books" button re-checks
 * Audible and updates the persisted rows incrementally: books now owned
 * or marked read drop out of `missing` automatically on next scan; newly
 * discovered gaps get added. Nothing is wiped and rebuilt from scratch.
 */
export default function GapsClient() {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading')
  const [scanning, setScanning] = useState(false)
  const [data, setData] = useState<GapsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(rescan: boolean) {
    if (rescan) setScanning(true)
    else setState('loading')
    setError(null)
    try {
      const res = await fetch(`/api/books/gaps${rescan ? '?rescan=1' : ''}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load')
        setState('error')
        return
      }
      setData(json)
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setState('error')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'loading') {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
        <div className="text-3xl animate-pulse">🔎</div>
        <p className="text-slate-400 text-sm">Loading your saved results…</p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-6 text-sm text-amber-100 space-y-3">
        <p>{error || 'Something went wrong.'}</p>
        <button
          type="button"
          onClick={() => void load(false)}
          className="text-amber-400 hover:text-amber-300 font-medium"
        >
          Try again →
        </button>
      </div>
    )
  }

  const seriesGaps = data?.seriesGaps || []
  const authorGaps = data?.authorGaps || []
  const totalMissing =
    seriesGaps.reduce((n, g) => n + g.missing.length, 0) +
    authorGaps.reduce((n, g) => n + g.missing.length, 0)
  const hasNeverScanned = !data?.scannedAt

  const scannedLabel = data?.scannedAt
    ? new Date(data.scannedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  if (hasNeverScanned) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-4">
        <div className="text-3xl">🔎</div>
        <h2 className="font-serif text-xl font-bold text-amber-100">
          Find books you might have missed
        </h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Scans every series and author you&apos;ve read against Audible&apos;s full catalog to
          find titles you don&apos;t own — books you may have read on Kindle, in print, or from
          the library and never logged, or ones you genuinely skipped. Results are saved, so you
          won&apos;t need to re-scan just to look at them again later.
        </p>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void load(true)}
          className="inline-block bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Scan for Missed Books'}
        </button>
        <p className="text-slate-600 text-xs">
          Can take 30–90 seconds depending on library size — checks each series/author against
          Audible one at a time to stay within rate limits.
        </p>
      </div>
    )
  }

  if (totalMissing === 0) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-8 text-center space-y-2">
        <div className="text-3xl">✅</div>
        <p className="text-emerald-300 font-medium">No gaps found</p>
        <p className="text-slate-400 text-sm">
          You&apos;re caught up on every series and author checked.
          {scannedLabel && <> Last checked {scannedLabel}.</>}
        </p>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void load(true)}
          className="text-amber-400 hover:text-amber-300 text-sm font-medium mt-2 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Scan for new books →'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-slate-400 text-sm">
          {totalMissing} book{totalMissing === 1 ? '' : 's'} you might be missing
          {scannedLabel && <span className="text-slate-600"> · checked {scannedLabel}</span>}
        </p>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void load(true)}
          className="text-xs text-amber-500 hover:text-amber-400 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Scan for new books →'}
        </button>
      </div>

      {seriesGaps.length > 0 && (
        <div>
          <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
            <span>🔖</span> Series You&apos;re Reading
          </h2>
          <div className="space-y-6">
            {seriesGaps.map((gap) => (
              <section key={`series-${gap.seriesName}`}>
                <h3 className="font-serif text-base font-semibold text-amber-200 mb-1">
                  {gap.seriesName}
                </h3>
                <p className="text-slate-500 text-sm mb-3">
                  {gap.author} · you&apos;ve read {gap.readCount} of {gap.totalKnown} known
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {gap.missing.map((release) => (
                    <GapBookCard key={release.asin} release={release} seriesName={gap.seriesName} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {authorGaps.length > 0 && (
        <div>
          <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
            <span>✍️</span> Other Books from Authors You&apos;ve Read
          </h2>
          <div className="space-y-6">
            {authorGaps.map((gap) => (
              <section key={`author-${gap.author}`}>
                <h3 className="font-serif text-base font-semibold text-amber-200 mb-1">
                  {gap.author}
                </h3>
                <p className="text-slate-500 text-sm mb-3">
                  You&apos;ve read {gap.readCount} book{gap.readCount === 1 ? '' : 's'} by this
                  author
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {gap.missing.map((release) => (
                    <GapBookCard key={release.asin} release={release} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
