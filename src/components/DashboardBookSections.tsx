'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Book } from '@/lib/books'
import { mapUiStatusToDb } from '@/lib/books'
import BookDetailModal, { type DetailStatus } from './BookDetailModal'

/**
 * Client wrapper for the Dashboard's "What to Read Next" section — the
 * Dashboard itself (src/app/page.tsx) is a server component, so the
 * click-to-open book detail modal (previously Library-only) needs a client
 * boundary. Same reversible Read/Unread/Want/Not-Interested status pattern
 * as Library — see BookDetailModal.tsx for the shared implementation.
 */
export default function WhatToReadNextSection({
  books,
  isAuthed,
}: {
  books: Book[]
  isAuthed: boolean
}) {
  const router = useRouter()
  const [detailAsin, setDetailAsin] = useState<string | null>(null)
  const [localBooks, setLocalBooks] = useState<Book[]>(books)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const setDetailStatus = useCallback(
    async (asin: string, next: DetailStatus) => {
      if (!isAuthed) return
      setPending((p) => ({ ...p, [asin]: true }))
      try {
        if (next === 'read') {
          await fetch('/api/books/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, status: mapUiStatusToDb('completed') }),
          })
        } else if (next === 'unread') {
          await fetch('/api/books/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, status: mapUiStatusToDb('unstarted') }),
          })
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'remove' }),
          })
        } else if (next === 'want') {
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'add' }),
          })
        } else {
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'not_interested' }),
          })
        }
        // Optimistically drop it from this "what to read next" list once
        // its status changes away from unstarted — it's served its purpose
        // here regardless of which direction it moved.
        setLocalBooks((prev) => prev.filter((b) => b.asin !== asin))
        setDetailAsin(null)
        router.refresh()
      } finally {
        setPending((p) => {
          const next = { ...p }
          delete next[asin]
          return next
        })
      }
    },
    [isAuthed, router]
  )

  const detailBook = localBooks.find((b) => b.asin === detailAsin)

  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4">
        {localBooks.map((book, i) => (
          <NextReadCard
            key={book.asin || `${book.title}-${i}`}
            book={book}
            rank={i + 1}
            onClick={() => book.asin && setDetailAsin(book.asin)}
          />
        ))}
        {localBooks.length === 0 && (
          <div className="col-span-3 text-slate-500 text-center py-8">
            {isAuthed
              ? 'No series recommendations yet — sync Audible and mark books read to build momentum.'
              : 'No recommendations available'}
          </div>
        )}
      </div>

      {detailBook && detailAsin && (
        <BookDetailModal
          book={detailBook}
          isPending={!!pending[detailAsin]}
          onClose={() => setDetailAsin(null)}
          onSetDetailStatus={isAuthed ? setDetailStatus : undefined}
        />
      )}
    </>
  )
}

function NextReadCard({
  book,
  rank,
  onClick,
}: {
  book: Book
  rank: number
  onClick: () => void
}) {
  const rankColors = ['text-amber-400', 'text-slate-300', 'text-amber-700']
  const rankEmojis = ['🥇', '🥈', '🥉']

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="bg-slate-900 rounded-xl border border-amber-500/20 p-5 hover:border-amber-500/40 transition-all group cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className={`text-2xl ${rankColors[rank - 1] || 'text-slate-400'}`}>
          {rankEmojis[rank - 1] || rank}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-100 text-sm leading-snug line-clamp-2 group-hover:text-amber-300 transition-colors">
            {book.title}
          </h3>
          <p className="text-slate-400 text-xs mt-1">{book.authors[0]}</p>
          {book.series && (
            <div className="mt-2">
              <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {book.series} #{book.series_num}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
