'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import type { DiscoveryHit } from '@/lib/books/discover-types'

function Cover({ hit }: { hit: DiscoveryHit }) {
  const [imgError, setImgError] = useState(false)
  if (hit.coverUrl && !imgError) {
    return (
      <div className="w-14 h-20 relative shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <Image
          src={hit.coverUrl}
          alt={hit.title}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          sizes="56px"
          unoptimized
        />
      </div>
    )
  }
  return (
    <div className="w-14 h-20 relative shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 flex items-center justify-center">
      <span className="text-amber-700/60 text-xl">📕</span>
    </div>
  )
}

/**
 * Every card has a real, working action from the moment it renders (F2 fix):
 * hits come from Audible's catalog directly, so they always have a real
 * ASIN and a real Audible URL — no "bridge may fail" dead-end state exists
 * here the way it did in the old Open-Library-based Gaps design.
 */
export default function DiscoverCard({ hit }: { hit: DiscoveryHit }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [wanted, setWanted] = useState(hit.alreadyWanted)

  async function handleWant() {
    if (busy || wanted || hit.alreadyOwned) return
    setBusy(true)
    try {
      const res = await fetch('/api/books/want', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          asin: hit.asin,
          title: hit.title,
          authors: hit.authors,
          series_name: hit.seriesName,
          series_position: hit.seriesPosition,
          cover_url: hit.coverUrl,
        }),
      })
      if (res.ok) {
        setWanted(true)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 hover:border-amber-500/30 transition-all p-4 flex gap-3">
      <Cover hit={hit} />
      <div className="flex-1 min-w-0">
        {hit.seriesName && (
          <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full inline-block mb-1">
            {hit.seriesName}
            {hit.seriesPosition != null ? ` #${hit.seriesPosition}` : ''}
          </span>
        )}
        <h3 className="font-semibold text-amber-100 leading-snug">{hit.title}</h3>
        <p className="text-slate-400 text-sm mt-0.5">{hit.authors.join(', ')}</p>
        {hit.rating != null ? (
          <p className="text-xs text-amber-400 mt-1">
            ★ {hit.rating.toFixed(1)}
            {hit.ratingCount != null ? ` (${hit.ratingCount.toLocaleString()})` : ''}
          </p>
        ) : (
          <p className="text-xs text-slate-600 mt-1">Not yet rated</p>
        )}
        {hit.similarityReason && (
          <p className="text-slate-500 text-xs mt-1 italic">{hit.similarityReason}</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <a
            href={hit.audibleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/25 transition-colors"
          >
            View on Audible →
          </a>
          {hit.alreadyOwned ? (
            <span className="text-[11px] text-emerald-400">✓ In your library</span>
          ) : wanted ? (
            <span className="text-[11px] text-violet-300">✓ Want to Read</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleWant()}
              className="text-[11px] font-medium text-violet-300 hover:text-violet-200 disabled:opacity-50"
            >
              {busy ? 'Adding…' : '+ Want to Read'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
