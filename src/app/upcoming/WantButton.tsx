'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { UpcomingRelease } from '@/lib/books/types'

/**
 * Add an Upcoming release to the user's Want to Read list.
 * Creates books + user_books rows (want_to_read=true) via /api/books/want.
 */
export default function WantButton({
  release,
  alreadyWanted = false,
  compact = false,
}: {
  release: UpcomingRelease
  alreadyWanted?: boolean
  compact?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(alreadyWanted)
  const [error, setError] = useState<string | null>(null)

  if (!release.asin) {
    return (
      <span
        className="text-[11px] text-slate-600"
        title="No ASIN yet — can’t add to library"
      >
        No ASIN
      </span>
    )
  }

  async function handleAdd() {
    if (!release.asin || busy || done) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/books/want', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          asin: release.asin,
          title: release.title,
          authors: release.authors?.length ? release.authors : [release.author],
          author: release.author,
          series_name: release.series,
          series: release.series,
          series_position: release.seriesNumber,
          seriesNumber: release.seriesNumber,
          cover_url: release.coverUrl,
          coverUrl: release.coverUrl,
          release_date: release.releaseDate,
          releaseDate: release.releaseDate,
          preorder_url: release.preorderUrl,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to add')
        return
      }
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <span
        className={`inline-flex items-center gap-1 ${
          compact
            ? 'text-[11px] text-violet-300'
            : 'text-xs text-violet-300 border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 rounded-lg'
        }`}
      >
        ✓ Want to Read
      </span>
    )
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleAdd()}
        className={
          compact
            ? 'text-[11px] font-medium text-violet-300 hover:text-violet-200 disabled:opacity-50'
            : 'text-xs font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg hover:bg-violet-500/25 transition-colors disabled:opacity-50'
        }
      >
        {busy ? 'Adding…' : '+ Want to Read'}
      </button>
      {error && (
        <span className="text-[10px] text-red-400 max-w-[12rem] text-right">{error}</span>
      )}
    </div>
  )
}
