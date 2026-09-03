'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { NormalizedCatalogRelease } from '@/lib/books/audible-catalog'
import MarkExternalReadButton from './MarkExternalReadButton'

function Cover({ release }: { release: NormalizedCatalogRelease }) {
  const [imgError, setImgError] = useState(false)
  if (release.coverUrl && !imgError) {
    return (
      <div className="w-14 h-20 relative shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <Image
          src={release.coverUrl}
          alt={release.title}
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

export default function GapBookCard({
  release,
  seriesName,
}: {
  release: NormalizedCatalogRelease
  seriesName?: string | null
}) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 hover:border-amber-500/30 transition-all p-4 flex gap-3">
      <Cover release={release} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {release.seriesPosition != null && (
            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
              #{release.seriesPosition}
            </span>
          )}
        </div>
        <h3 className="font-semibold text-amber-100 leading-snug">{release.title}</h3>
        <p className="text-slate-400 text-sm mt-0.5">{release.authors.join(', ')}</p>
        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <a
            href={release.preorderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/25 transition-colors"
          >
            Buy →
          </a>
          <MarkExternalReadButton
            release={release}
            seriesName={seriesName}
            seriesPosition={release.seriesPosition}
          />
        </div>
      </div>
    </div>
  )
}
