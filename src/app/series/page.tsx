import { loadLibraryBundle } from '@/lib/books/queries'
import SeriesClient from './SeriesClient'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function SeriesPage() {
  const bundle = await loadLibraryBundle()

  return (
    <>
      {bundle.demoBanner && (
        <div className="bg-slate-800/80 border-b border-slate-700 px-4 py-2 text-center mb-4">
          <p className="text-slate-300 text-sm">
            Demo data —{' '}
            <Link href="/auth/login" className="text-amber-400 hover:text-amber-300">
              sign in
            </Link>{' '}
            for your live series.
          </p>
        </div>
      )}
      {bundle.isAuthed && bundle.stats.totalSeries === 0 && bundle.books.length > 0 && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3 mb-4 text-sm text-amber-200">
          Live library loaded ({bundle.books.length} books) but no series tags yet.
          Run <strong>Sync Now</strong> in Settings — the fixed sync requests the Audible{' '}
          <code className="text-amber-300">series</code> response group.
        </div>
      )}
      <SeriesClient
        series={bundle.series}
        isAuthed={bundle.isAuthed}
        source={bundle.source}
      />
    </>
  )
}
