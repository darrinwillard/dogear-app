'use client'

import { useState } from 'react'
import type { SeriesGap, AuthorGap } from '@/lib/books/gaps'
import GapBookCard from './GapBookCard'

interface GapsResponse {
  seriesGaps: SeriesGap[]
  authorGaps: AuthorGap[]
  scannedAt: string
  error?: string
}

/**
 * "Fill In Series/Author Gaps" tab. Manual, on-demand scan (not run on
 * every page load) — hits Audible's catalog + sims APIs per series/author
 * the user has read, so it's slower and rate-limit-sensitive. User taps
 * "Scan for Missed Books" and results render below; nothing is persisted.
 */
export default function GapsClient() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [data, setData] = useState<GapsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runScan() {
    setState('loading')
    setError(null)
    try {
      const res = await fetch('/api/books/gaps')
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Scan failed')
        setState('error')
        return
      }
      setData(json)
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-4">
        <div className="text-3xl">🔎</div>
        <h2 className="font-serif text-xl font-bold text-amber-100">
          Find books you might have missed
        </h2>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Scans every series and author you&apos;ve read against Audible&apos;s full catalog to
          find titles you don&apos;t own — books you may have read on Kindle, in print, or from
          the library and never logged, or ones you genuinely skipped.
        </p>
        <button
          type="button"
          onClick={() => void runScan()}
          className="inline-block bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors"
        >
          Scan for Missed Books
        </button>
        <p className="text-slate-600 text-xs">
          Can take 30–90 seconds depending on library size — checks each series/author against
          Audible one at a time to stay within rate limits.
        </p>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
        <div className="text-3xl animate-pulse">🔎</div>
        <p className="text-slate-400 text-sm">
          Checking your series and authors against Audible&apos;s catalog…
        </p>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-6 text-sm text-amber-100 space-y-3">
        <p>{error || 'Something went wrong.'}</p>
        <button
          type="button"
          onClick={() => void runScan()}
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

  if (totalMissing === 0) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-8 text-center space-y-2">
        <div className="text-3xl">✅</div>
        <p className="text-emerald-300 font-medium">No gaps found</p>
        <p className="text-slate-400 text-sm">
          You&apos;re caught up on every series and author checked.
        </p>
        <button
          type="button"
          onClick={() => void runScan()}
          className="text-amber-400 hover:text-amber-300 text-sm font-medium mt-2"
        >
          Scan again →
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">
          Found {totalMissing} book{totalMissing === 1 ? '' : 's'} you might be missing
        </p>
        <button
          type="button"
          onClick={() => void runScan()}
          className="text-xs text-amber-500 hover:text-amber-400"
        >
          Re-scan →
        </button>
      </div>

      {seriesGaps.map((gap) => (
        <section key={`series-${gap.seriesName}`}>
          <h2 className="font-serif text-lg font-bold text-amber-100 mb-1 flex items-center gap-2">
            <span>🔖</span> {gap.seriesName}
          </h2>
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

      {authorGaps.map((gap) => (
        <section key={`author-${gap.author}`}>
          <h2 className="font-serif text-lg font-bold text-amber-100 mb-1 flex items-center gap-2">
            <span>✍️</span> {gap.author}
          </h2>
          <p className="text-slate-500 text-sm mb-3">
            You&apos;ve read {gap.readCount} book{gap.readCount === 1 ? '' : 's'} by this author
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gap.missing.map((release) => (
              <GapBookCard key={release.asin} release={release} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
