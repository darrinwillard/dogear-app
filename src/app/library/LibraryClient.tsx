'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Book,
  getStatusLabel,
  formatDate,
  formatRuntime,
  timeRemainingMinutes,
  mapUiStatusToDb,
  isAlmostFinishedCandidate,
  almostFinishedLabel,
  isCurrentlyReading,
  isWantToRead,
  isOwnedUnread,
  isReadStatus,
  buyOrPreorderUrl,
  isFutureRelease,
} from '@/lib/books'
import BookDetailModal, { type DetailStatus } from '@/components/BookDetailModal'

interface Props {
  books: Book[]
  isAuthed?: boolean
  isNewUser?: boolean
  source?: 'live' | 'demo'
  lastSyncedAt?: string | null
}

type FilterTab =
  | 'all'
  | 'read'
  | 'reading'
  | 'owned'
  | 'want'

type PendingMap = Record<string, boolean>

/**
 * Live library UI.
 * - Server props are baseline truth for status/rating/progress.
 * - Status / mark-as-read / dismiss write via authenticated APIs (ASIN-keyed).
 * - Almost-finished candidates (percent>=90 or is_finished) get a confirm strip + badge.
 */
export default function LibraryClient({
  books: initialBooks,
  isAuthed = false,
  isNewUser = false,
  source = 'demo',
  lastSyncedAt = null,
}: Props) {
  const router = useRouter()
  const [books, setBooks] = useState<Book[]>(initialBooks)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [syncing, setSyncing] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingMap>({})
  const [detailAsin, setDetailAsin] = useState<string | null>(null)
  const [genreFilter, setGenreFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'default' | 'genre' | 'title' | 'author'>('default')

  // Re-sync local optimistic state when server props change (router.refresh).
  // Guard: never let a refreshed prop silently revert a status/want field
  // that's still mid-flight (pending) for that ASIN — a concurrent Audible
  // sync or a slow read-replica can otherwise stomp an optimistic "Read"
  // right back to "Unread" milliseconds after the user's click.
  useEffect(() => {
    setBooks((prev) => {
      const prevByAsin = new Map(prev.map((b) => [b.asin, b]))
      return initialBooks.map((incoming) => {
        if (incoming.asin && pending[incoming.asin]) {
          const local = prevByAsin.get(incoming.asin)
          if (local) return local
        }
        return incoming
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBooks])

  const getEffectiveStatus = useCallback((book: Book) => book.status, [])
  const getEffectiveRating = useCallback(
    (book: Book) => book.gr_rating ?? null,
    []
  )

  const setPendingAsin = useCallback((asin: string, value: boolean) => {
    setPending((prev) => {
      if (!!prev[asin] === value) return prev
      const next = { ...prev }
      if (value) next[asin] = true
      else delete next[asin]
      return next
    })
  }, [])

  const patchBookLocal = useCallback((asin: string, patch: Partial<Book>) => {
    setBooks((prev) =>
      prev.map((b) => (b.asin === asin ? { ...b, ...patch } : b))
    )
  }, [])

  const setRating = useCallback(
    async (asin: string | null | undefined, stars: number) => {
      if (!asin) {
        setStatusNote('Missing ASIN — cannot save rating.')
        return
      }
      if (!isAuthed) {
        setStatusNote('Sign in to save ratings across devices.')
        return
      }
      setPendingAsin(asin, true)
      const previous = books.find((b) => b.asin === asin)?.gr_rating ?? null
      patchBookLocal(asin, { gr_rating: stars })
      try {
        const res = await fetch('/api/books/rating', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin, rating: stars }),
        })
        if (res.status === 404) {
          // Rating API may not be shipped yet — soft message, keep optimistic
          setStatusNote('Rating API not available yet — change not saved.')
          patchBookLocal(asin, { gr_rating: previous })
          return
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          patchBookLocal(asin, { gr_rating: previous })
          setStatusNote(data.error || 'Failed to save rating')
          return
        }
        setStatusNote(null)
        router.refresh()
      } catch (e) {
        patchBookLocal(asin, { gr_rating: previous })
        setStatusNote(e instanceof Error ? e.message : 'Failed to save rating')
      } finally {
        setPendingAsin(asin, false)
      }
    },
    [books, isAuthed, patchBookLocal, router, setPendingAsin]
  )

  const applyStatus = useCallback(
    async (asin: string, uiOrDbStatus: string) => {
      if (!asin) {
        setStatusNote('Missing ASIN — cannot save status. This is a data bug, tell Darrin.')
        return
      }
      if (!isAuthed) {
        setStatusNote('Sign in to save status across devices.')
        return
      }
      setPendingAsin(asin, true)
      const previous = books.find((b) => b.asin === asin)
      if (!previous) {
        // Book isn't in local state at all — write would silently target
        // nothing meaningful client-side. Surface loudly instead of no-op.
        setStatusNote(`Book ${asin} not found in loaded library — refresh and retry.`)
        setPendingAsin(asin, false)
        return
      }
      const dbStatus = mapUiStatusToDb(uiOrDbStatus)
      const uiStatus =
        dbStatus === 'completed'
          ? 'read'
          : dbStatus === 'in_progress'
            ? 'reading'
            : previous?.wantToRead && !previous?.audible_purchased
              ? 'want_to_read'
              : 'owned_unread'

      // Optimistic
      patchBookLocal(asin, {
        status: uiStatus,
        statusSource: 'user',
        finishedAt: dbStatus === 'completed' ? new Date().toISOString() : null,
        // Clear almost-finished once completed
        ...(dbStatus === 'completed'
          ? {
              almostFinishedDismissedAt: previous?.almostFinishedDismissedAt ?? null,
              // A finished book is never still "Want to Read" — clear the
              // flag so isWantToRead() stops returning true and the
              // Mark as Read / Buy / Want-actions row actually disappears.
              wantToRead: false,
            }
          : {}),
      })

      try {
        const res = await fetch('/api/books/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin, status: dbStatus }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (previous) {
            patchBookLocal(asin, {
              status: previous.status,
              statusSource: previous.statusSource,
              finishedAt: previous.finishedAt,
            })
          }
          setStatusNote(data.error || 'Failed to save status')
          return
        }
        setStatusNote(
          dbStatus === 'completed' ? 'Marked as read ✓' : `Status → ${getStatusLabel(uiStatus)}`
        )
        router.refresh()
      } catch (e) {
        if (previous) {
          patchBookLocal(asin, {
            status: previous.status,
            statusSource: previous.statusSource,
            finishedAt: previous.finishedAt,
          })
        }
        setStatusNote(e instanceof Error ? e.message : 'Failed to save status')
      } finally {
        setPendingAsin(asin, false)
      }
    },
    [books, isAuthed, patchBookLocal, router, setPendingAsin]
  )

  const cycleStatus = useCallback(
    (asin: string | null | undefined, currentStatus: string) => {
      if (!asin) {
        setStatusNote('Missing ASIN — cannot change status.')
        return
      }
      // Progress cycle only: Owned/Unread → Reading → Read → Owned/Unread
      // Want-to-read is a separate flag (not part of this cycle).
      const order = ['owned_unread', 'reading', 'read'] as const
      const normalized =
        currentStatus === 'read_no_date' || currentStatus === 'completed'
          ? 'read'
          : currentStatus === 'currently-reading' || currentStatus === 'in_progress'
            ? 'reading'
            : currentStatus === 'unstarted' ||
                currentStatus === 'to_read' ||
                currentStatus === 'want_to_read'
              ? 'owned_unread'
              : currentStatus
      const idx = order.indexOf(normalized as (typeof order)[number])
      const next = order[(idx >= 0 ? idx + 1 : 0) % order.length]
      void applyStatus(asin, next)
    },
    [applyStatus]
  )

  const setWantFlag = useCallback(
    async (
      asin: string,
      action: 'add' | 'remove' | 'not_interested',
      extra?: Partial<Book>
    ) => {
      if (!asin) {
        setStatusNote('Missing ASIN — cannot update Want to Read.')
        return
      }
      if (!isAuthed) {
        setStatusNote('Sign in to update Want to Read.')
        return
      }
      setPendingAsin(asin, true)
      const previous = books.find((b) => b.asin === asin)
      if (!previous) {
        setStatusNote(`Book ${asin} not found in loaded library — refresh and retry.`)
        setPendingAsin(asin, false)
        return
      }
      // Optimistic
      if (action === 'add') {
        patchBookLocal(asin, {
          wantToRead: true,
          notInterested: false,
          status:
            previous?.status === 'read' || previous?.status === 'reading'
              ? previous.status
              : previous?.audible_purchased
                ? previous.status
                : 'want_to_read',
          ...extra,
        })
      } else if (action === 'not_interested') {
        patchBookLocal(asin, {
          wantToRead: false,
          notInterested: true,
        })
      } else {
        patchBookLocal(asin, { wantToRead: false })
      }
      try {
        const res = await fetch('/api/books/want', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin, action }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (previous) {
            patchBookLocal(asin, {
              wantToRead: previous.wantToRead,
              notInterested: previous.notInterested,
              status: previous.status,
            })
          }
          setStatusNote(data.error || 'Failed to update Want to Read')
          return
        }
        setStatusNote(
          action === 'add'
            ? 'Added to Want to Read ✓'
            : action === 'not_interested'
              ? 'Marked Not Interested — removed from Want to Read'
              : 'Removed from Want to Read'
        )
        router.refresh()
      } catch (e) {
        if (previous) {
          patchBookLocal(asin, {
            wantToRead: previous.wantToRead,
            notInterested: previous.notInterested,
            status: previous.status,
          })
        }
        setStatusNote(e instanceof Error ? e.message : 'Failed to update Want to Read')
      } finally {
        setPendingAsin(asin, false)
      }
    },
    [books, isAuthed, patchBookLocal, router, setPendingAsin]
  )

  const markAsRead = useCallback(
    (asin: string) => {
      void applyStatus(asin, 'completed')
    },
    [applyStatus]
  )

  /**
   * Detail modal status change — freely reversible across all four states.
   * 'read'/'unread' go through applyStatus (progress); 'want'/'not_interested'
   * go through setWantFlag (wishlist flag). Moving off 'want' or
   * 'not_interested' back to plain 'unread' clears both flags via setWantFlag
   * 'remove' so a mistaken click never gets stuck.
   */
  const setDetailStatus = useCallback(
    (asin: string, next: DetailStatus) => {
      if (next === 'read') {
        void applyStatus(asin, 'completed')
      } else if (next === 'unread') {
        void applyStatus(asin, 'unstarted')
        void setWantFlag(asin, 'remove')
      } else if (next === 'want') {
        void setWantFlag(asin, 'add')
      } else {
        void setWantFlag(asin, 'not_interested')
      }
    },
    [applyStatus, setWantFlag]
  )

  const dismissAlmostFinished = useCallback(
    async (asin: string) => {
      if (!isAuthed) {
        setStatusNote('Sign in to dismiss prompts.')
        return
      }
      setPendingAsin(asin, true)
      const previous = books.find((b) => b.asin === asin)?.almostFinishedDismissedAt ?? null
      const now = new Date().toISOString()
      patchBookLocal(asin, { almostFinishedDismissedAt: now })
      try {
        const res = await fetch('/api/books/dismiss-almost-finished', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          patchBookLocal(asin, { almostFinishedDismissedAt: previous })
          setStatusNote(data.error || 'Failed to dismiss')
          return
        }
        setStatusNote('Dismissed — won’t nag on this title.')
        router.refresh()
      } catch (e) {
        patchBookLocal(asin, { almostFinishedDismissedAt: previous })
        setStatusNote(e instanceof Error ? e.message : 'Failed to dismiss')
      } finally {
        setPendingAsin(asin, false)
      }
    },
    [books, isAuthed, patchBookLocal, router, setPendingAsin]
  )

  async function handleSync() {
    setSyncing(true)
    setStatusNote(null)
    try {
      const res = await fetch('/api/audible/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatusNote(data.error || 'Sync failed')
        return
      }

      let libraryNote =
        `Synced ${data.books_synced ?? 0} books` +
        (data.series_fields_written != null
          ? ` · series tags written: ${data.series_fields_written}`
          : '') +
        (data.progress_fields_written != null
          ? ` · progress updates: ${data.progress_fields_written}`
          : '')

      // Also refresh upcoming releases every time — throttled server-side
      // (7-day window) so this is a no-op most syncs, not an extra full scan.
      try {
        const relRes = await fetch('/api/audible/releases', { method: 'POST' })
        const relData = await relRes.json().catch(() => ({}))
        if (relRes.ok && !relData.skipped) {
          libraryNote += ` · releases refreshed`
        }
      } catch {
        // Releases refresh is best-effort — library sync already succeeded.
      }

      setStatusNote(libraryNote)
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  const almostFinished = useMemo(
    () => books.filter(isAlmostFinishedCandidate),
    [books]
  )

  const currentlyReading = useMemo(
    () => books.filter(isCurrentlyReading),
    [books]
  )

  const tabFiltered = useMemo(() => {
    return books.filter((book) => {
      if (activeTab === 'read') {
        const status = getEffectiveStatus(book)
        return status === 'read' || status === 'read_no_date'
      }
      if (activeTab === 'reading') return isCurrentlyReading(book)
      if (activeTab === 'owned') return isOwnedUnread(book)
      if (activeTab === 'want') return isWantToRead(book)
      return true
    })
  }, [books, activeTab, getEffectiveStatus])

  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const b of books) if (b.genre) set.add(b.genre)
    return Array.from(set).sort()
  }, [books])

  const genreFiltered = useMemo(() => {
    if (genreFilter === 'all') return tabFiltered
    if (genreFilter === 'unset') return tabFiltered.filter((b) => !b.genre)
    return tabFiltered.filter((b) => b.genre === genreFilter)
  }, [tabFiltered, genreFilter])

  const searched = useMemo(() => {
    if (!search) return genreFiltered
    const q = search.toLowerCase()
    return genreFiltered.filter(
      (book) =>
        book.title.toLowerCase().includes(q) ||
        book.authors.some((a) => a.toLowerCase().includes(q)) ||
        (book.series?.toLowerCase().includes(q))
    )
  }, [genreFiltered, search])

  const filtered = useMemo(() => {
    if (sortBy === 'default') return searched
    const arr = [...searched]
    if (sortBy === 'genre') {
      arr.sort((a, b) => (a.genre || 'zzz').localeCompare(b.genre || 'zzz') || a.title.localeCompare(b.title))
    } else if (sortBy === 'title') {
      arr.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy === 'author') {
      arr.sort((a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || ''))
    }
    return arr
  }, [searched, sortBy])

  const stats = useMemo(() => {
    const read = books.filter((b) => {
      const s = getEffectiveStatus(b)
      return s === 'read' || s === 'read_no_date'
    }).length
    const audible = books.filter((b) => b.sources.includes('audible')).length
    const withSeries = books.filter((b) => Boolean(b.series)).length
    const rated = books
      .map((b) => getEffectiveRating(b))
      .filter((r) => r !== null) as number[]
    const avgRating =
      rated.length > 0
        ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)
        : null
    return {
      total: books.length,
      read,
      audible,
      withSeries,
      avgRating,
      ratedCount: rated.length,
      almost: almostFinished.length,
      reading: currentlyReading.length,
    }
  }, [books, getEffectiveStatus, getEffectiveRating, almostFinished.length, currentlyReading.length])

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: books.length },
    {
      key: 'read',
      label: 'Read',
      count: books.filter((b) => {
        const s = getEffectiveStatus(b)
        return s === 'read' || s === 'read_no_date'
      }).length,
    },
    {
      key: 'reading',
      label: 'Reading',
      count: currentlyReading.length,
    },
    {
      key: 'owned',
      label: 'Owned · Unread',
      count: books.filter((b) => isOwnedUnread(b)).length,
    },
    {
      key: 'want',
      label: 'Want to Read',
      count: books.filter((b) => isWantToRead(b)).length,
    },
  ]

  if (isNewUser) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-3xl font-bold text-amber-400">Library</h1>
        <div className="text-center py-20">
          <div className="text-6xl mb-5">🎧</div>
          <h2 className="text-xl font-semibold text-amber-50 mb-2">
            Your library is empty
          </h2>
          <p className="text-slate-400 mb-8 max-w-sm mx-auto">
            Connect your Audible account to sync your books and get started.
          </p>
          <Link
            href="/settings/connect-audible"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-xl transition-colors"
          >
            <span>🎧</span> Connect Audible Account
          </Link>
          <p className="mt-4 text-slate-500 text-sm">
            You can also{' '}
            <Link href="/settings" className="text-amber-500 hover:text-amber-400">
              visit Settings
            </Link>{' '}
            to manage your account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">Library</h1>
          <p className="text-slate-400 mt-1">
            {filtered.length.toLocaleString()} of {books.length.toLocaleString()}{' '}
            books
            {source === 'live' && (
              <span className="text-slate-500">
                {' '}
                · live Supabase
                {lastSyncedAt ? ` · synced ${formatDate(lastSyncedAt)}` : ''}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAuthed && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`p-2 rounded-lg transition-colors text-sm font-medium ${
                syncing
                  ? 'text-amber-400 bg-amber-500/10 cursor-not-allowed'
                  : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'
              }`}
              title={syncing ? 'Syncing...' : 'Sync Audible library'}
            >
              {syncing ? '⏳' : '🔄'}
            </button>
          )}
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded-lg transition-colors ${
              view === 'grid'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Grid view"
          >
            ⊞
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-lg transition-colors ${
              view === 'list'
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="List view"
          >
            ☰
          </button>
        </div>
      </div>

      {statusNote && (
        <div className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
          <span>{statusNote}</span>
          <button
            type="button"
            onClick={() => setStatusNote(null)}
            className="text-slate-400 hover:text-slate-200 text-xs shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {isAuthed && almostFinished.length > 0 && activeTab !== 'reading' && (
        <AlmostFinishedStrip
          books={almostFinished}
          pending={pending}
          onMarkRead={markAsRead}
          onDismiss={dismissAlmostFinished}
          onSeeAll={() => setActiveTab('reading')}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-amber-400">{stats.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">Total Books</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-emerald-400">{stats.read}</div>
          <div className="text-xs text-slate-400 mt-0.5">Read (DB)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{stats.reading}</div>
          <div className="text-xs text-slate-400 mt-0.5">Reading</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-amber-400">
            {stats.avgRating ? `★ ${stats.avgRating}` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Avg Rating</div>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search by title, author, or series..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 text-sm"
      />

      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-500"
          >
            <option value="all">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            <option value="unset">No genre yet</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-500"
          >
            <option value="default">Sort: default</option>
            <option value="genre">Sort: genre</option>
            <option value="title">Sort: title</option>
            <option value="author">Sort: author</option>
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-amber-500 text-slate-900'
                : 'bg-slate-800 text-slate-400 hover:text-amber-200 hover:bg-slate-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`ml-1.5 text-xs ${
                  activeTab === tab.key ? 'text-slate-700' : 'text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((book, i) => (
            <BookCard
              key={book.asin || book.userBookId || `${book.title}-${i}`}
              book={book}
              effectiveStatus={getEffectiveStatus(book)}
              effectiveRating={getEffectiveRating(book)}
              isPending={!!(book.asin && pending[book.asin])}
              showAlmost={isAlmostFinishedCandidate(book)}
              showWantActions={activeTab === 'want' || isWantToRead(book)}
              onRate={(asin, stars) => void setRating(asin, stars)}
              onCycleStatus={cycleStatus}
              onMarkRead={markAsRead}
              onDismiss={dismissAlmostFinished}
              onWantAction={(asin, action) => void setWantFlag(asin, action)}
              onOpenDetail={setDetailAsin}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((book, i) => (
            <BookRow
              key={book.asin || book.userBookId || `${book.title}-${i}`}
              book={book}
              effectiveStatus={getEffectiveStatus(book)}
              effectiveRating={getEffectiveRating(book)}
              isPending={!!(book.asin && pending[book.asin])}
              showAlmost={isAlmostFinishedCandidate(book)}
              showWantActions={activeTab === 'want' || isWantToRead(book)}
              onRate={(asin, stars) => void setRating(asin, stars)}
              onCycleStatus={cycleStatus}
              onMarkRead={markAsRead}
              onDismiss={dismissAlmostFinished}
              onWantAction={(asin, action) => void setWantFlag(asin, action)}
              onOpenDetail={setDetailAsin}
            />
          ))}
        </div>
      )}

      {detailAsin && (() => {
        const detailBook = books.find((b) => b.asin === detailAsin)
        if (!detailBook) return null
        return (
          <BookDetailModal
            book={detailBook}
            isPending={!!pending[detailAsin]}
            onClose={() => setDetailAsin(null)}
            onSetDetailStatus={setDetailStatus}
          />
        )
      })()}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <div>No books match your filters</div>
          <button
            onClick={() => {
              setSearch('')
              setActiveTab('all')
            }}
            className="mt-2 text-amber-500 hover:text-amber-400 text-sm"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}

function AlmostFinishedStrip({
  books,
  pending,
  onMarkRead,
  onDismiss,
  onSeeAll,
}: {
  books: Book[]
  pending: PendingMap
  onMarkRead: (asin: string) => void
  onDismiss: (asin: string) => void
  onSeeAll: () => void
}) {
  const preview = books.slice(0, 5)
  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-orange-200">
            Finish these? · {books.length} near the end
          </h2>
          <p className="text-xs text-orange-200/70 mt-0.5">
            Audible shows ≥90% (or finished). Confirm to mark read — never auto-completed.
          </p>
        </div>
        {books.length > preview.length && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-xs text-orange-300 hover:text-orange-100 shrink-0"
          >
            See all →
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {preview.map((book) => {
          const asin = book.asin
          if (!asin) return null
          const busy = !!pending[asin]
          return (
            <li
              key={asin}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-slate-950/40 rounded-lg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-amber-50 truncate font-medium">
                  {book.title}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  {book.authors[0] || 'Unknown'} · {almostFinishedLabel(book)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMarkRead(asin)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Mark as read
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDismiss(asin)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Not yet
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface CardProps {
  book: Book
  effectiveStatus: string
  effectiveRating: number | null
  isPending: boolean
  showAlmost: boolean
  showWantActions?: boolean
  onRate: (asin: string | null | undefined, stars: number) => void
  onCycleStatus: (asin: string | null | undefined, currentStatus: string) => void
  onMarkRead: (asin: string) => void
  onDismiss: (asin: string) => void
  onWantAction: (asin: string, action: 'add' | 'remove' | 'not_interested') => void
  onOpenDetail: (asin: string) => void
}

/**
 * 10-star scale — each star = 0.5 rating points (5.0 max rating = all 10 lit).
 * Replaces the old 5-star + half-star-split design: half ratings now render
 * as a fully lit star instead of a visually-fiddly half-filled glyph, and
 * every star is a full, unambiguous tap target (no left/right split needed).
 */
function StarRating({
  rating,
  onRate,
  asin,
  disabled,
}: {
  rating: number | null
  onRate: (asin: string | null | undefined, s: number) => void
  asin: string | null | undefined
  disabled?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const effective = hover ?? rating ?? 0

  return (
    <div className="flex">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => {
        // Each star represents 0.5 of the underlying 0.5-5.0 rating.
        const starValue = star * 0.5
        const filled = effective >= starValue
        return (
          <button
            key={star}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              onRate(asin, starValue)
            }}
            onMouseEnter={() => setHover(starValue)}
            onMouseLeave={() => setHover(null)}
            className="relative inline-flex items-center justify-center w-4 h-5 text-sm leading-none transition-colors disabled:opacity-40 touch-manipulation"
            title={`Rate ${starValue} / 5`}
          >
            <span
              aria-hidden
              className={filled ? 'text-amber-400' : 'text-slate-600'}
            >
              ★
            </span>
          </button>
        )
      })}
    </div>
  )
}

function StatusBadge({
  status,
  onCycle,
  asin,
  disabled,
  wantToRead,
}: {
  status: string
  onCycle: (asin: string | null | undefined, s: string) => void
  asin: string | null | undefined
  disabled?: boolean
  wantToRead?: boolean
}) {
  const colorMap: Record<string, string> = {
    read: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    read_no_date: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    reading: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    'currently-reading': 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    to_read: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    owned_unread: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    want_to_read: 'bg-violet-400/10 text-violet-300 border-violet-400/20',
  }
  const displayStatus =
    wantToRead && (status === 'owned_unread' || status === 'to_read' || status === 'unstarted')
      ? 'want_to_read'
      : status
  const color =
    colorMap[displayStatus] || 'bg-slate-400/10 text-slate-400 border-slate-400/20'
  return (
    <button
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onCycle(asin, status)
      }}
      className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-opacity hover:opacity-70 disabled:opacity-40 ${color}`}
      title="Click to cycle reading progress (Owned → Reading → Read)"
    >
      {getStatusLabel(displayStatus)}
    </button>
  )
}

/**
 * Actions for Owned · Unread books (Audible-synced, not started, not on the
 * wishlist). Three real options: mark Finished, add to Want to Read (moves it
 * into the active wishlist queue even though it's already owned), or Not
 * Interested (hides it from the unread nudge without pretending it's read).
 */
function OwnedUnreadActions({
  asin,
  busy,
  onMarkRead,
  onWantAction,
  compact,
}: {
  asin: string
  busy: boolean
  onMarkRead: (asin: string) => void
  onWantAction: (asin: string, action: 'add' | 'remove' | 'not_interested') => void
  compact?: boolean
}) {
  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap gap-1.5'} w-full`}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onMarkRead(asin)
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500 text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
        title="Mark as read"
      >
        Read
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onWantAction(asin, 'add')
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
        title="Add to Want to Read"
      >
        Want to Read
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onWantAction(asin, 'not_interested')
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        title="Not interested"
      >
        Not interested
      </button>
    </div>
  )
}

function WantActions({
  book,
  busy,
  onWantAction,
  onMarkRead,
  compact,
}: {
  book: Book
  busy: boolean
  onWantAction: (asin: string, action: 'add' | 'remove' | 'not_interested') => void
  onMarkRead?: (asin: string) => void
  compact?: boolean
}) {
  const asin = book.asin
  if (!asin) return null
  const url = buyOrPreorderUrl(book)
  const future = isFutureRelease(book.releaseDate)
  const buyLabel = future ? 'Pre-order' : 'Buy'

  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap gap-1.5'} w-full`}>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-center px-2 py-1 rounded-md text-[11px] font-semibold bg-amber-500 text-slate-900 hover:bg-amber-400"
        >
          {buyLabel} →
        </a>
      )}
      {onMarkRead && (
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onMarkRead(asin)
          }}
          className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500 text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
          title="Mark as read"
        >
          Read
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onWantAction(asin, 'not_interested')
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        title="Remove from Want to Read"
      >
        Not interested
      </button>
    </div>
  )
}

function AlmostBadge({ book }: { book: Book }) {
  return (
    <div
      className="text-[10px] leading-tight px-1.5 py-0.5 rounded-md bg-orange-500 text-slate-900 font-semibold shadow-sm"
      title="Audible progress suggests this may be finished"
    >
      Almost · {book.percentComplete != null ? `${Math.round(book.percentComplete)}%` : 'done'}
    </div>
  )
}

function AlmostActions({
  asin,
  busy,
  onMarkRead,
  onDismiss,
  compact,
}: {
  asin: string
  busy: boolean
  onMarkRead: (asin: string) => void
  onDismiss: (asin: string) => void
  compact?: boolean
}) {
  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap gap-1.5'} w-full`}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onMarkRead(asin)
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500 text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
      >
        Mark as read?
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(asin)
        }}
        className="flex-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
      >
        Not yet
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
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
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
        <div className="text-xs text-slate-500 font-serif leading-tight line-clamp-3 text-center">
          {book.title}
        </div>
      </div>
    </div>
  )
}

function BookCard({
  book,
  effectiveStatus,
  effectiveRating,
  isPending,
  showAlmost,
  showWantActions,
  onRate,
  onCycleStatus,
  onMarkRead,
  onDismiss,
  onWantAction,
  onOpenDetail,
}: CardProps) {
  const asin = book.asin
  const onWant = isWantToRead(book)
  const isFinished = isReadStatus(effectiveStatus)
  const remaining = !isFinished
    ? timeRemainingMinutes(book.runtime_length_min, book.percentComplete)
    : null
  const runtime =
    remaining != null ? `${formatRuntime(remaining)} left` : formatRuntime(book.runtime_length_min)

  return (
    <div
      onClick={() => asin && onOpenDetail(asin)}
      role="button"
      tabIndex={0}
      className={`group bg-slate-900 rounded-xl border overflow-hidden transition-all hover:-translate-y-0.5 cursor-pointer ${
        showAlmost
          ? 'border-orange-500/50 hover:border-orange-400/70'
          : onWant
            ? 'border-violet-500/40 hover:border-violet-400/60'
            : 'border-slate-800 hover:border-amber-500/40'
      }`}
    >
      <div className="aspect-[2/3] relative overflow-hidden">
        <CoverImage book={book} />
        <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
          {showAlmost && <AlmostBadge book={book} />}
          {onWant && !showAlmost && (
            <div className="text-[10px] leading-tight px-1.5 py-0.5 rounded-md bg-violet-500 text-slate-900 font-semibold shadow-sm">
              Want
            </div>
          )}
          <StatusBadge
            status={effectiveStatus}
            onCycle={onCycleStatus}
            asin={asin}
            disabled={isPending}
            wantToRead={onWant}
          />
        </div>
        {runtime && (
          <div className="absolute bottom-2 left-2 z-10 text-xs bg-slate-900/80 text-slate-300 px-1.5 py-0.5 rounded backdrop-blur-sm">
            {runtime}
          </div>
        )}
      </div>

      <div className="p-2 space-y-1.5">
        <h3 className="text-xs font-medium text-amber-100 line-clamp-2 leading-snug group-hover:text-amber-300 transition-colors">
          {book.title}
        </h3>
        <p className="text-xs text-slate-500 truncate">{book.authors[0]}</p>
        {book.narrator && (
          <p className="text-xs text-slate-500 truncate">
            <span className="text-slate-600">🎙</span> {book.narrator}
          </p>
        )}
        {book.series && (
          <p className="text-xs text-amber-700 truncate">
            #{book.series_num} · {book.series}
          </p>
        )}
        {book.genre && (
          <span className="inline-block text-[10px] text-slate-400 bg-slate-800 border border-slate-700 rounded-full px-1.5 py-0.5 mt-0.5">
            {book.genre}
          </span>
        )}
        {book.releaseDate && onWant && (
          <p className="text-[10px] text-violet-300/80 truncate">
            {isFutureRelease(book.releaseDate) ? 'Releases' : 'Released'}{' '}
            {formatDate(book.releaseDate)}
          </p>
        )}
        <StarRating
          rating={effectiveRating}
          onRate={onRate}
          asin={asin}
          disabled={isPending}
        />
        {showAlmost && asin && (
          <AlmostActions
            asin={asin}
            busy={isPending}
            onMarkRead={onMarkRead}
            onDismiss={onDismiss}
            compact
          />
        )}
        {showWantActions && onWant && !isFinished && (
          <WantActions
            book={book}
            busy={isPending}
            onWantAction={onWantAction}
            onMarkRead={onMarkRead}
            compact
          />
        )}
        {!onWant && !isFinished && isOwnedUnread(book) && asin && (
          <OwnedUnreadActions
            asin={asin}
            busy={isPending}
            onMarkRead={onMarkRead}
            onWantAction={onWantAction}
            compact
          />
        )}
      </div>
    </div>
  )
}

function BookRow({
  book,
  effectiveStatus,
  effectiveRating,
  isPending,
  showAlmost,
  showWantActions,
  onRate,
  onCycleStatus,
  onMarkRead,
  onDismiss,
  onWantAction,
  onOpenDetail,
}: CardProps) {
  const [imgError, setImgError] = useState(false)
  const asin = book.asin
  const onWant = isWantToRead(book)
  const isFinished = isReadStatus(effectiveStatus)
  const remaining = !isFinished
    ? timeRemainingMinutes(book.runtime_length_min, book.percentComplete)
    : null
  const runtime =
    remaining != null ? `${formatRuntime(remaining)} left` : formatRuntime(book.runtime_length_min)

  return (
    <div
      onClick={() => asin && onOpenDetail(asin)}
      role="button"
      tabIndex={0}
      className={`bg-slate-900 rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 transition-colors cursor-pointer ${
        showAlmost
          ? 'border-orange-500/40 hover:border-orange-400/60'
          : onWant
            ? 'border-violet-500/30 hover:border-violet-400/50'
            : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="w-10 h-14 bg-slate-800 rounded overflow-hidden relative shrink-0">
          {book.cover_url && !imgError ? (
            <Image
              src={book.cover_url}
              alt={book.title}
              fill
              className="object-cover"
              onError={() => setImgError(true)}
              sizes="40px"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-600 text-xs font-serif">📖</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-amber-100 text-sm truncate">{book.title}</h3>
            {showAlmost && <AlmostBadge book={book} />}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">{book.authors.join(', ')}</p>
          {book.narrator && (
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              🎙 {book.narrator}
            </p>
          )}
          {book.series && (
            <p className="text-amber-700 text-xs mt-0.5">
              {book.series} #{book.series_num}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 sm:gap-3">
        {runtime && (
          <span className="hidden sm:block text-xs text-slate-500">{runtime}</span>
        )}
        {book.audible_purchased && !runtime && (
          <div className="hidden sm:block text-xs text-slate-500">
            {formatDate(book.audible_purchased)}
          </div>
        )}
        <StarRating
          rating={effectiveRating}
          onRate={onRate}
          asin={asin}
          disabled={isPending}
        />
        <StatusBadge
          status={effectiveStatus}
          onCycle={onCycleStatus}
          asin={asin}
          disabled={isPending}
          wantToRead={onWant}
        />
        {showAlmost && asin && (
          <AlmostActions
            asin={asin}
            busy={isPending}
            onMarkRead={onMarkRead}
            onDismiss={onDismiss}
          />
        )}
        {showWantActions && onWant && !isFinished && (
          <WantActions
            book={book}
            busy={isPending}
            onWantAction={onWantAction}
            onMarkRead={onMarkRead}
          />
        )}
        {!onWant && !isFinished && isOwnedUnread(book) && asin && (
          <OwnedUnreadActions
            asin={asin}
            busy={isPending}
            onMarkRead={onMarkRead}
            onWantAction={onWantAction}
          />
        )}
        {book.sources.includes('audible') && (
          <span title="Audible" className="text-base">
            🎧
          </span>
        )}
      </div>
    </div>
  )
}
