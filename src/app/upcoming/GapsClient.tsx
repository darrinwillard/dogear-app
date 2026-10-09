'use client'

import { useEffect, useState } from 'react'
import type { SeriesGap, AuthorGap } from '@/lib/books/gaps'
import GapBookCard from './GapBookCard'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`w-4 h-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function GapGroupSection({
  id,
  title,
  subtitle,
  missingCount,
  defaultOpen,
  onToggle,
  open,
  children,
}: {
  id: string
  title: string
  subtitle: string
  missingCount: number
  defaultOpen?: boolean
  onToggle: (id: string) => void
  open: boolean
  children: React.ReactNode
}) {
  void defaultOpen
  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-800/40 transition-colors"
      >
        <div className="min-w-0 flex items-center gap-2">
          <ChevronIcon open={open} />
          <div className="min-w-0">
            <h3 className="font-serif text-base font-semibold text-amber-200 truncate">{title}</h3>
            <p className="text-slate-500 text-sm truncate">{subtitle}</p>
          </div>
        </div>
        <span className="shrink-0 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-full">
          {missingCount} missing
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>}
    </section>
  )
}

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
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          <div className="space-y-3">
            {seriesGaps.map((gap) => {
              const id = `series-${gap.seriesName}`
              return (
                <GapGroupSection
                  key={id}
                  id={id}
                  title={gap.seriesName}
                  subtitle={`${gap.author} · you've read ${gap.readCount} of ${gap.totalKnown} known`}
                  missingCount={gap.missing.length}
                  open={openGroups.has(id)}
                  onToggle={toggleGroup}
                >
                  {gap.missing.map((release) => (
                    <GapBookCard key={release.asin} release={release} seriesName={gap.seriesName} />
                  ))}
                </GapGroupSection>
              )
            })}
          </div>
        </div>
      )}

      {authorGaps.length > 0 && (
        <div>
          <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
            <span>✍️</span> Other Books from Authors You&apos;ve Read
          </h2>
          <div className="space-y-3">
            {authorGaps.map((gap) => {
              const id = `author-${gap.author}`
              return (
                <GapGroupSection
                  key={id}
                  id={id}
                  title={gap.author}
                  subtitle={`You've read ${gap.readCount} book${gap.readCount === 1 ? '' : 's'} by this author`}
                  missingCount={gap.missing.length}
                  open={openGroups.has(id)}
                  onToggle={toggleGroup}
                >
                  {gap.missing.map((release) => (
                    <GapBookCard key={release.asin} release={release} />
                  ))}
                </GapGroupSection>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
