import Link from 'next/link'
import { formatDate, isWantToRead } from '@/lib/books'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { getUpcomingPageData, type UpcomingPageData } from '@/lib/books/releases'
import type { UpcomingRelease } from '@/lib/books/types'
import { createClient } from '@/lib/supabase/server'
import ReleaseCover from './ReleaseCover'
import WantButton from './WantButton'
import { ReleaseDetailProvider } from '@/components/ReleaseDetailWrapper'
import ReleaseCardClick from '@/components/ReleaseCardClick'
import StopPropagation from '@/components/StopPropagation'

export const dynamic = 'force-dynamic'

export default async function UpcomingPage() {
  const library = await getLibraryForCurrentUser()

  let lastRefreshedAt: string | null = null
  if (library.isAuthed && library.userId) {
    try {
      const supabase = await createClient()
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('last_releases_synced_at')
        .eq('id', library.userId)
        .maybeSingle()
      if (!profile && false) {
        // type noop
      }
      lastRefreshedAt = (profile as { last_releases_synced_at?: string } | null)
        ?.last_releases_synced_at ?? null
      if (!lastRefreshedAt) {
        const { data: latest } = await supabase
          .from('series_releases')
          .select('updated_at')
          .in('source', ['audible_catalog', 'audible_sims'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        lastRefreshedAt = latest?.updated_at ?? null
      }
    } catch {
      // non-fatal — column may be missing pre-migration 003
      try {
        const supabase = await createClient()
        const { data: latest } = await supabase
          .from('series_releases')
          .select('updated_at')
          .in('source', ['audible_catalog', 'audible_sims'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        lastRefreshedAt = latest?.updated_at ?? null
      } catch {
        // ignore
      }
    }
  }

  const data = await getUpcomingPageData({
    books: library.books,
    isAuthed: library.isAuthed,
    lastRefreshedAt,
  })

  const wantedAsins = new Set(
    library.books.filter((b) => isWantToRead(b) && b.asin).map((b) => b.asin as string)
  )

  const refreshedLabel = lastRefreshedAt
    ? new Date(lastRefreshedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <ReleaseDetailProvider isAuthed={data.isAuthed}>
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">Upcoming Releases</h1>
          <p className="text-slate-400 mt-1">
            {data.source === 'demo'
              ? 'Demo snapshot — sign in for live Audible catalog releases'
              : 'Live from Audible catalog · series you follow + authors you’ve read'}
          </p>
          {refreshedLabel && (
            <p className="text-slate-500 text-xs mt-1">Last catalog refresh · {refreshedLabel}</p>
          )}
        </div>
        {data.isAuthed && (
          <Link
            href="/settings"
            className="text-sm text-amber-500 hover:text-amber-400 border border-amber-500/30 rounded-lg px-3 py-2 self-start"
          >
            Refresh in Settings →
          </Link>
        )}
      </div>

      {data.source === 'demo' && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-300">
          Showing curated demo data (March 2026 snapshot).{' '}
          <Link href="/auth/login" className="text-amber-400 hover:text-amber-300">
            Sign in
          </Link>{' '}
          and run <strong>Refresh Releases</strong> for your live calendar.
        </div>
      )}

      {data.source === 'empty' && data.emptyReason && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-4 text-sm text-amber-100 space-y-2">
          <p>{data.emptyReason}</p>
          <Link href="/settings" className="inline-block text-amber-400 hover:text-amber-300 font-medium">
            Open Settings →
          </Link>
        </div>
      )}

      {data.source === 'live' && (
        <p className="text-slate-500 text-xs">
          Scoped to series you’ve started (and recently finished) plus authors with books marked read.
          Only titles Audible has listed as preorder/catalog entries appear — publisher-only announcements won’t.
        </p>
      )}

      {/* Series you're following */}
      <ReleaseSection
        title="In series you’re reading"
        emoji="🔖"
        subtitle="Next books in series you’ve started or recently finished"
        releases={data.seriesUpcoming}
        empty={
          data.source === 'live'
            ? 'No upcoming series titles found yet. Refresh Releases after marking books read.'
            : undefined
        }
        showSeriesBadge
        isAuthed={data.isAuthed}
        wantedAsins={wantedAsins}
      />

      {/* Authors you've read */}
      {(data.source !== 'demo' || data.authorUpcoming.length > 0) && (
        <ReleaseSection
          title="New from authors you’ve read"
          emoji="✍️"
          subtitle="Standalones and new series from authors in your read history — not just series you already track"
          releases={data.authorUpcoming}
          empty={
            data.source === 'live'
              ? 'No extra author releases outside your followed series right now.'
              : undefined
          }
          showSeriesBadge
          isAuthed={data.isAuthed}
          wantedAsins={wantedAsins}
        />
      )}

      {/* Announced / TBA */}
      {data.announcedNoDate.length > 0 && (
        <section>
          <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
            <span>🔮</span> Announced
            <span className="text-sm font-normal text-slate-400">(no firm date yet)</span>
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.announcedNoDate.map((release, i) => (
              <CompactCard
                key={release.asin || `${release.title}-${i}`}
                release={release}
                isAuthed={data.isAuthed}
                alreadyWanted={!!(release.asin && wantedAsins.has(release.asin))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Recently released */}
      {data.releasedRecently.length > 0 && (
        <section>
          <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
            <span>✅</span> Recently released
            <span className="text-sm font-normal text-slate-400">(already out)</span>
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.releasedRecently.map((release, i) => (
              <ReleaseCardClick
                key={release.asin || `${release.title}-${i}`}
                release={release}
                className="bg-slate-900/60 rounded-xl border border-emerald-500/20 p-4 hover:border-emerald-500/40 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    {release.series}
                    {release.seriesNumber != null ? ` #${release.seriesNumber}` : ''}
                  </span>
                  <span className="text-lg">✅</span>
                </div>
                <h3 className="font-semibold text-amber-100 mb-1">{release.title}</h3>
                <p className="text-slate-400 text-sm mb-2">{release.author}</p>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">
                    Released {formatDate(release.releaseDate)}
                  </span>
                  <StopPropagation className="flex items-center gap-2">
                    {data.isAuthed && (
                      <WantButton
                        release={release}
                        alreadyWanted={!!(release.asin && wantedAsins.has(release.asin))}
                        compact
                      />
                    )}
                    {release.preorderUrl && (
                      <a
                        href={release.preorderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:text-amber-400"
                      >
                        Buy →
                      </a>
                    )}
                  </StopPropagation>
                </div>
              </ReleaseCardClick>
            ))}
          </div>
        </section>
      )}

      {data.source === 'live' && <StatsFooter data={data} />}
    </div>
    </ReleaseDetailProvider>
  )
}

function ReleaseSection({
  title,
  emoji,
  subtitle,
  releases,
  empty,
  showSeriesBadge,
  isAuthed,
  wantedAsins,
}: {
  title: string
  emoji: string
  subtitle: string
  releases: UpcomingRelease[]
  empty?: string
  showSeriesBadge?: boolean
  isAuthed?: boolean
  wantedAsins?: Set<string>
}) {
  return (
    <section>
      <h2 className="font-serif text-xl font-bold text-amber-100 mb-1 flex items-center gap-2">
        <span>{emoji}</span> {title}
      </h2>
      <p className="text-slate-500 text-sm mb-4">{subtitle}</p>
      {releases.length === 0 ? (
        empty ? (
          <div className="text-slate-500 text-sm py-4">{empty}</div>
        ) : null
      ) : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-slate-800 hidden sm:block" />
          <div className="space-y-4">
            {releases.map((release, i) => {
              const daysUntil = release.releaseDate
                ? Math.ceil(
                    (new Date(release.releaseDate + 'T12:00:00').getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24)
                  )
                : null
              const isPast = daysUntil !== null && daysUntil < 0

              return (
                <div
                  key={release.asin || `${release.title}-${i}`}
                  className="sm:pl-14 relative group"
                >
                  <div className="hidden sm:flex absolute left-3 top-5 w-5 h-5 rounded-full bg-amber-500 border-2 border-slate-950 items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-amber-300" />
                  </div>

                  <ReleaseCardClick
                    release={release}
                    className={`bg-slate-900 rounded-xl border ${
                      isPast
                        ? 'border-slate-800 opacity-60'
                        : 'border-slate-800 hover:border-amber-500/30'
                    } p-5 transition-all cursor-pointer`}
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <ReleaseCover release={release} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {release.genre && (
                            <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full">
                              {release.genre}
                            </span>
                          )}
                          {showSeriesBadge && (
                            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                              {release.series}
                              {release.seriesNumber != null ? ` #${release.seriesNumber}` : ''}
                            </span>
                          )}
                          {release.interestKind === 'author' && (
                            <span className="text-xs bg-sky-500/10 text-sky-300 border border-sky-500/20 px-2 py-0.5 rounded-full">
                              Author follow
                            </span>
                          )}
                          {daysUntil !== null && daysUntil > 0 && (
                            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                              {daysUntil} days away
                            </span>
                          )}
                          {isPast && (
                            <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                              Past due / just out
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-amber-100 text-lg mb-1">
                          {release.title}
                        </h3>
                        <p className="text-slate-400 text-sm">{release.author}</p>
                        {release.notes && (
                          <p className="text-slate-500 text-xs mt-2 italic">{release.notes}</p>
                        )}
                      </div>
                      <StopPropagation className="shrink-0 text-right space-y-2">
                        <div className="text-sm font-medium text-amber-400">
                          {formatDate(release.releaseDate)}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {isAuthed && (
                            <WantButton
                              release={release}
                              alreadyWanted={!!(release.asin && wantedAsins?.has(release.asin))}
                            />
                          )}
                          {release.preorderUrl && (
                            <a
                              href={release.preorderUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/25 transition-colors"
                            >
                              {isPast ? 'View on Audible →' : 'Pre-order →'}
                            </a>
                          )}
                        </div>
                      </StopPropagation>
                    </div>
                  </ReleaseCardClick>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function CompactCard({
  release,
  isAuthed,
  alreadyWanted,
}: {
  release: UpcomingRelease
  isAuthed?: boolean
  alreadyWanted?: boolean
}) {
  return (
    <ReleaseCardClick
      release={release}
      className="bg-slate-900/60 rounded-xl border border-slate-800 p-4 hover:border-slate-700 transition-all cursor-pointer"
    >
      <div className="flex gap-3">
        <ReleaseCover release={release} />
        <div className="flex-1 min-w-0">
          <div className="mb-2">
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
              {release.series}
              {release.seriesNumber != null ? ` #${release.seriesNumber}` : ''}
            </span>
          </div>
          <h3 className="font-semibold text-amber-100 mb-1">{release.title}</h3>
          <p className="text-slate-400 text-sm mb-2">{release.author}</p>
          {release.notes && <p className="text-slate-500 text-xs italic">{release.notes}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600">📅 Date TBA</span>
            <StopPropagation>
              {isAuthed && (
                <WantButton release={release} alreadyWanted={alreadyWanted} compact />
              )}
            </StopPropagation>
          </div>
        </div>
      </div>
    </ReleaseCardClick>
  )
}

function StatsFooter({ data }: { data: UpcomingPageData }) {
  return (
    <p className="text-slate-600 text-xs border-t border-slate-900 pt-4">
      Showing {data.seriesUpcoming.length} series follow · {data.authorUpcoming.length} author
      discoveries · {data.releasedRecently.length} recent releases
      {data.all.length ? ` · ${data.all.length} catalog rows total` : ''}
    </p>
  )
}
