'use client'

import { useState } from 'react'
import type { DiscoveryHit } from '@/lib/books/discover-types'
import type { Book } from '@/lib/books/types'
import DiscoverCard from './DiscoverCard'

const GENRE_CHIPS = [
  'Science Fiction',
  'Fantasy',
  'Mystery',
  'Thriller',
  'Romance',
  'Nonfiction',
  'Horror',
  'Biography',
]

function LibrarySearchTab({ books }: { books: Book[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const results = q
    ? books.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          (b.series || '').toLowerCase().includes(q)
      )
    : []

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your library by title, author, or series…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      {q && (
        <p className="text-slate-500 text-xs">
          {results.length} match{results.length === 1 ? '' : 'es'}
        </p>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.slice(0, 60).map((b) => (
          <div
            key={b.asin || b.title}
            className="bg-slate-900 rounded-xl border border-slate-800 p-3 flex gap-3"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-100 text-sm leading-snug">{b.title}</h3>
              <p className="text-slate-400 text-xs mt-0.5">{b.authors.join(', ')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DiscoverTab() {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [minRating, setMinRating] = useState(4.0)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hits, setHits] = useState<DiscoveryHit[]>([])
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    if (!query.trim() && !author.trim() && !subject) return
    setState('loading')
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (author.trim()) params.set('author', author.trim())
      if (subject) params.set('subject', subject)
      params.set('minRating', String(minRating))
      const res = await fetch(`/api/books/discover?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Search failed')
        setState('error')
        return
      }
      setHits(data.hits || [])
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setState('error')
    }
  }

  return (
    <div className="space-y-5">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search title, author, genre…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      <input
        type="text"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        placeholder="Filter by author (optional)…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      <div className="flex flex-wrap gap-2">
        {GENRE_CHIPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setSubject(subject === g ? null : g)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              subject === g
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-500 shrink-0">Min rating</label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-xs text-amber-400 w-10 text-right">{minRating.toFixed(1)}+</span>
      </div>
      <button
        type="button"
        onClick={() => void runSearch()}
        className="w-full bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors"
      >
        Search
      </button>

      {state === 'loading' && (
        <div className="text-center py-8 text-slate-400 text-sm animate-pulse">
          Searching Audible&apos;s catalog…
        </div>
      )}
      {state === 'error' && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-sm text-amber-100">
          {error}
        </div>
      )}
      {state === 'done' && hits.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          No results at that rating threshold — try lowering it.
        </div>
      )}
      {state === 'done' && hits.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {hits.map((hit) => (
            <DiscoverCard key={hit.asin} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

function SimilarTab({ books }: { books: Book[] }) {
  const rated = books.filter((b) => b.status === 'completed' && b.asin)
  const [selected, setSelected] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hits, setHits] = useState<DiscoveryHit[]>([])
  const [error, setError] = useState<string | null>(null)

  function toggle(asin: string) {
    setSelected((prev) =>
      prev.includes(asin) ? prev.filter((a) => a !== asin) : prev.length < 3 ? [...prev, asin] : prev
    )
  }

  async function findSimilar() {
    if (!selected.length) return
    setState('loading')
    setError(null)
    try {
      const res = await fetch(`/api/books/similar?seeds=${selected.join(',')}&minRating=4.0`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Search failed')
        setState('error')
        return
      }
      setHits(data.hits || [])
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setState('error')
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-slate-400 text-sm">
        Pick up to 3 books you loved — we&apos;ll find similar, highly-rated books on Audible.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-y-auto">
        {rated.slice(0, 100).map((b) => (
          <button
            key={b.asin}
            type="button"
            onClick={() => toggle(b.asin as string)}
            className={`text-left text-xs p-2.5 rounded-lg border transition-colors ${
              selected.includes(b.asin as string)
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            {b.title}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!selected.length}
        onClick={() => void findSimilar()}
        className="w-full bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-40"
      >
        Find similar high-rated books ({selected.length} selected)
      </button>

      {state === 'loading' && (
        <div className="text-center py-8 text-slate-400 text-sm animate-pulse">
          Checking Audible for similar books…
        </div>
      )}
      {state === 'error' && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-sm text-amber-100">
          {error}
        </div>
      )}
      {state === 'done' && hits.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          No high-rated matches found — try different seed books.
        </div>
      )}
      {state === 'done' && hits.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {hits.map((hit) => (
            <DiscoverCard key={hit.asin} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SearchClient({ books }: { books: Book[] }) {
  const [tab, setTab] = useState<'library' | 'discover' | 'similar'>('discover')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-amber-400">Discover</h1>
        <p className="text-slate-500 text-sm mt-1">Find books beyond your library</p>
      </div>

      <div className="flex gap-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'library'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          📚 Library
        </button>
        <button
          type="button"
          onClick={() => setTab('discover')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'discover'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🔍 Discover
        </button>
        <button
          type="button"
          onClick={() => setTab('similar')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'similar'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🎯 Similar
        </button>
      </div>

      {tab === 'library' && <LibrarySearchTab books={books} />}
      {tab === 'discover' && <DiscoverTab />}
      {tab === 'similar' && <SimilarTab books={books} />}
    </div>
  )
}
