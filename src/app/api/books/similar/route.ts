import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { refreshAudibleAccessToken } from '@/lib/books/audible-token'
import { getSeriesSims } from '@/lib/books/audible-catalog'
import { toDiscoveryHit, ownedAsinSet, wantedAsinSet, rankAndFilterHits } from '@/lib/books/discover'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

/**
 * GET /api/books/similar?seeds=asin1,asin2,asin3&minRating=
 *
 * "Find something similar" — uses Audible's RawSimilarities sims type
 * (confirmed live 2026-09-03 against a real owned ASIN: 5 genuinely
 * relevant results returned, e.g. seeding on "1984" returned Animal Farm,
 * Brave New World, Lord of the Flies). Capped at 3 seeds to stay within
 * a reasonable request count per call (sequential, matching the Gaps
 * pattern's rate discipline).
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
    const seedAsins = (searchParams.get('seeds') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
    const minRating = searchParams.get('minRating') ? Number(searchParams.get('minRating')) : 4.0

    if (!seedAsins.length) {
      return NextResponse.json({ error: 'Provide at least one seed ASIN via ?seeds=' }, { status: 400 })
    }

    const library = await getLibraryForCurrentUser()
    const owned = ownedAsinSet(library.books)
    const wanted = wantedAsinSet(library.books)
    const seedTitleByAsin = new Map(
      library.books.filter((b) => b.asin).map((b) => [b.asin as string, b.title])
    )

    const allHits: ReturnType<typeof toDiscoveryHit>[] = []
    for (const asin of seedAsins) {
      try {
        const sims = await getSeriesSims(accessToken, asin, 'RawSimilarities', 15, {
          includeRating: true,
        })
        const seedTitle = seedTitleByAsin.get(asin) || 'a book you liked'
        for (const r of sims) {
          allHits.push(toDiscoveryHit(r, owned, wanted, `Similar to ${seedTitle}`))
        }
      } catch (e) {
        console.warn('[books/similar] sims failed for', asin, e)
        // Skip this seed, keep going — one bad seed shouldn't kill the request.
      }
    }

    const hits = rankAndFilterHits(allHits, { minRating, minRatingsCount: 0 })

    return NextResponse.json({
      hits,
      seeds: seedAsins,
      scannedAt: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/similar]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
