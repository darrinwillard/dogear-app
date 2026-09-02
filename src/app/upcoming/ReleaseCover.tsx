'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { UpcomingRelease } from '@/lib/books/types'

export default function ReleaseCover({ release }: { release: UpcomingRelease }) {
  const [imgError, setImgError] = useState(false)
  const src = release.coverUrl

  if (src && !imgError) {
    return (
      <div className="w-14 h-20 sm:w-16 sm:h-24 relative shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <Image
          src={src}
          alt={release.title}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          sizes="64px"
          unoptimized
        />
      </div>
    )
  }

  return (
    <div className="w-14 h-20 sm:w-16 sm:h-24 relative shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-900/20 to-transparent" />
      <span className="relative z-10 text-amber-700/60 text-2xl">📕</span>
    </div>
  )
}
