'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NormalizedCatalogRelease } from '@/lib/books/audible-catalog'

/**
 * "Mark as Read" for a gap-detected book (no user_books row yet). Used on
 * the Fill In Gaps tab for titles the user may have read outside Audible.
 * Writes via /api/books/mark-external-read, which creates the books +
 * user_books rows on the fly with status_source='user_external'.
 */
export default function MarkExternalReadButton({
  release,
  seriesName,
  seriesPosition,
}: {
  release: NormalizedCatalogRelease
  seriesName?: string | null
  seriesPosition?: number | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMark() {
    if (busy || done) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/books/mark-external-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: release.asin,
          title: release.title,
          authors: release.authors,
          seriesName: seriesName ?? release.seriesName ?? null,
          seriesPosition: seriesPosition ?? release.seriesPosition ?? null,
          coverUrl: release.coverUrl,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to save')
        return
      }
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
        ✓ Marked read
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleMark()}
        className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
      >
        {busy ? 'Saving…' : "I've read this"}
      </button>
      {error && <span className="text-[10px] text-red-400 max-w-[10rem] text-right">{error}</span>}
    </div>
  )
}
