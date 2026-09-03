import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { refreshAudibleAccessToken } from '@/lib/books/audible-token'
import { searchCatalog } from '@/lib/books/audible-catalog'
import { toDiscoveryHit, ownedAsinSet, wantedAsinSet, rankAndFilterHits } from '@/lib/books/discover'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/books/discover?q=&author=&subject=&minRating=&minRatingsCount=&sort=
 *
 * Audible-only discovery search (ratings hierarchy decision, 2026-09-03:
 * Audible `rating` response group is the sole ratings source — Goodreads
 * scraping was live-tested and dropped due to broad/aggressive AWS WAF
 * blocking; Open Library was dropped earlier for the same "this app is
 * Audible-only anyway" reasoning).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('audible_refresh_token')
      .eq('id', user.id)
      .single()

    const { accessToken, error: tokenError } = await refreshAudibleAccessToken(
      profile?.audible_refresh_token
    )
    if (!accessToken || tokenError) {
      return NextResponse.json(
        { error: tokenError?.message ?? 'Audible token refresh failed.' },
        { status: tokenError?.status ?? 401 }
      )
    }

    const searchParams = req.nextUrl.searchParams
    const q = searchParams.get('q') || undefined
    const author = searchParams.get('author') || undefined
    const subject = searchParams.get('subject') || undefined
    const minRating = searchParams.get('minRating')
      ? Number(searchParams.get('minRating'))
      : undefined
    const minRatingsCount = searchParams.get('minRatingsCount')
      ? Number(searchParams.get('minRatingsCount'))
      : 5
    const sort = searchParams.get('sort') === 'new' ? 'ReleaseDate' : 'AvgRating'
    const limit = Math.min(Number(searchParams.get('limit') || 20), 40)

    if (!q && !author && !subject) {
      return NextResponse.json(
        { error: 'Provide at least one of q, author, or subject.' },
        { status: 400 }
      )
    }

    const keywords = [q, subject].filter(Boolean).join(' ') || undefined

    const results = await searchCatalog(accessToken, {
      keywords,
      author,
      sortBy: sort,
      numResults: limit,
    })

    const library = await getLibraryForCurrentUser()
    const owned = ownedAsinSet(library.books)
    const wanted = wantedAsinSet(library.books)

    const hits = rankAndFilterHits(
      results.map((r) => toDiscoveryHit(r, owned, wanted)),
      { minRating, minRatingsCount }
    )

    return NextResponse.json({
      hits,
      scannedAt: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/discover]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
