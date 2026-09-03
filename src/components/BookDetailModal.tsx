'use client'

import Image from 'next/image'
import { useState } from 'react'
import type { Book } from '@/lib/books'
import {
  formatRuntime,
  timeRemainingMinutes,
  isReadStatus,
  isReadingStatus,
  isWantToRead,
} from '@/lib/books'

/**
 * Shared book detail popup — used on Library, Dashboard, Series, and
 * Upcoming. Shows synopsis + metadata, plus a status selector that can move
 * freely between all four states (Read / Unread / Want to Read / Not
 * Interested) rather than one-directional buttons — this is the fix for
 * "we need to be able to change these back if we mistakenly hit read."
 *
 * Originally built inline in LibraryClient.tsx; extracted here so every
 * page that shows books can open the same popup on tap instead of each
 * page needing its own copy.
 */
export type DetailStatus = 'read' | 'unread' | 'want' | 'not_interested'

export function getDetailStatus(book: Book): DetailStatus {
  if (isReadStatus(book.status)) return 'read'
  if (book.notInterested) return 'not_interested'
  if (isWantToRead(book)) return 'want'
  return 'unread'
}

function SynopsisText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  // Only clamp/offer expand for genuinely long synopses.
  const isLong = text.length > 220

  if (!isLong) {
    return (
      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">
        {text}
      </p>
    )
  }

  return (
    <div>
      <p
        className={`text-slate-300 text-sm leading-relaxed whitespace-pre-line ${
          expanded ? '' : 'line-clamp-4'
        }`}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-amber-500 hover:text-amber-400 text-xs font-medium mt-1.5"
      >
        {expanded ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}

function CoverImage({ book }: { book: Book }) {
  const [imgError, setImgError] = useState(false)

  if (book.cover_url && !imgError) {
    return (
      <Image
        src={book.cover_url}
        alt={book.title}
        fill
        className="object-cover"
        onError={() => setImgError(true)}
        sizes="96px"
        unoptimized
      />
    )
  }

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-900/20 to-transparent" />
      <div className="text-center px-2 relative z-10">
        <div className="w-8 h-10 mx-auto mb-1 border border-amber-800/40 rounded-sm bg-amber-900/20 flex items-center justify-center">
          <span className="text-amber-700/60 text-xs font-serif">A</span>
        </div>
      </div>
    </div>
  )
}

export interface BookDetailModalProps {
  book: Book
  isPending: boolean
  onClose: () => void
  /**
   * Omit to render a read-only detail view (no status controls) — used for
   * pages like Upcoming where the book isn't owned yet and the four-way
   * Read/Unread/Want/Not-Interested selector doesn't apply the same way.
   */
  onSetDetailStatus?: (asin: string, next: DetailStatus) => void
  /** Optional extra action row (e.g. Pre-order/Buy on Upcoming) rendered
   *  above the status selector. */
  extraActions?: React.ReactNode
}

export default function BookDetailModal({
  book,
  isPending,
  onClose,
  onSetDetailStatus,
  extraActions,
}: BookDetailModalProps) {
  const asin = book.asin
  const current = getDetailStatus(book)
  const isReading = isReadingStatus(book.status)
  const remaining = timeRemainingMinutes(book.runtime_length_min, book.percentComplete)
  const year = book.releaseDate ? book.releaseDate.slice(0, 4) : null

  const statusOptions: { key: DetailStatus; label: string; color: string }[] = [
    { key: 'read', label: 'Read', color: 'bg-emerald-500 text-slate-900' },
    { key: 'unread', label: 'Unread', color: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
    { key: 'want', label: 'Want to Read', color: 'bg-violet-500/20 text-violet-300 border border-violet-500/40' },
    { key: 'not_interested', label: 'Not Interested', color: 'bg-slate-700 text-slate-300' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between z-10">
          <h2 className="font-serif text-lg font-bold text-amber-100 truncate pr-4">
            Book Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl leading-none shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-4">
            <div className="w-24 h-36 shrink-0 rounded-lg overflow-hidden relative bg-slate-800">
              <CoverImage book={book} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-lg font-bold text-amber-50 leading-snug">
                {book.title}
              </h3>
              <p className="text-slate-400 text-sm mt-1">{book.authors.join(', ')}</p>
              {book.series && (
                <p className="text-amber-600 text-sm mt-1">
                  {book.series} #{book.series_num}
                </p>
              )}
              {isReading && remaining != null && (
                <p className="text-blue-300 text-xs mt-2">
                  {formatRuntime(remaining)} left
                  {book.percentComplete != null
                    ? ` · ${Math.round(book.percentComplete)}% complete`
                    : ''}
                </p>
              )}
            </div>
          </div>

          {/* Metadata grid — length, year, narrator, publisher */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {book.runtime_length_min != null && (
              <div>
                <div className="text-xs text-slate-500">Length</div>
                <div className="text-amber-50">{formatRuntime(book.runtime_length_min)}</div>
              </div>
            )}
            {year && (
              <div>
                <div className="text-xs text-slate-500">Released</div>
                <div className="text-amber-50">{year}</div>
              </div>
            )}
            {book.narrator && (
              <div>
                <div className="text-xs text-slate-500">Narrator</div>
                <div className="text-amber-50 truncate">{book.narrator}</div>
              </div>
            )}
            {book.publisher && (
              <div>
                <div className="text-xs text-slate-500">Publisher</div>
                <div className="text-amber-50 truncate">{book.publisher}</div>
              </div>
            )}
          </div>

          {/* Synopsis */}
          <div>
            <div className="text-xs text-slate-500 mb-1">Synopsis</div>
            {book.summary ? (
              <SynopsisText text={book.summary} />
            ) : (
              <p className="text-slate-500 text-sm italic">
                No synopsis available for this title yet.
              </p>
            )}
          </div>

          {extraActions}

          {/* Status selector — freely reversible, all four states always shown.
              Omitted entirely when onSetDetailStatus isn't provided (e.g. a
              catalog title on Upcoming that isn't owned yet). */}
          {asin && onSetDetailStatus && (
            <div>
              <div className="text-xs text-slate-500 mb-2">Status</div>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={isPending}
                    onClick={() => onSetDetailStatus(asin, opt.key)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      current === opt.key
                        ? opt.color
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Switch between any of these anytime — nothing here is one-way.
              </p>
            </div>
          )}

          {asin && book.audible_purchased && (
            <a
              href={`https://www.audible.com/pd/${encodeURIComponent(asin)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm text-amber-500 hover:text-amber-400"
            >
              View on Audible →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
