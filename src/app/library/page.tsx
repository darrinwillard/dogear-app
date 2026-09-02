import { loadLibraryBundle } from '@/lib/books/queries'
import LibraryClient from './LibraryClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams?: { syncing?: string }
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const syncing = searchParams?.syncing === '1'
  const bundle = await loadLibraryBundle()

  return (
    <>
      {bundle.demoBanner && (
        <div className="bg-slate-800/80 border-b border-slate-700 px-4 py-2 text-center">
          <p className="text-slate-300 text-sm">
            Demo data — <a href="/auth/login" className="text-amber-400 hover:text-amber-300">sign in</a> to sync your Audible library.
          </p>
        </div>
      )}
      {syncing && (
        <div className="bg-amber-400/10 border-b border-amber-400/30 px-4 py-3 text-center">
          <p className="text-amber-300 text-sm">
            ⏳ Syncing your Audible library… This may take a moment.
          </p>
        </div>
      )}
      <LibraryClient
        books={bundle.books}
        isAuthed={bundle.isAuthed}
        isNewUser={bundle.isNewUser}
        source={bundle.source}
        lastSyncedAt={bundle.lastSyncedAt}
      />
    </>
  )
}
