import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { findSeriesGaps, findAuthorGaps } from '@/lib/books/gaps'
import { refreshAudibleAccessToken } from '@/lib/books/audible-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/books/gaps
 *
 * On-demand series/author gap scan — deliberately NOT run on every page
 * load (hits Audible's catalog + sims APIs per series/author, rate-limit
 * risk and slow). Client calls this when the user opens the "Fill In
 * Gaps" tab; results aren't persisted, so it re-scans each time (fine for
 * a manual, occasional-use tool — matches how Refresh Releases already
 * works in Settings).
 */
export async function GET() {
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

    const library = await getLibraryForCurrentUser()

    const seriesGaps = await findSeriesGaps(accessToken, library.books)
    const seriesGapAsins = new Set(seriesGaps.flatMap((g) => g.missing.map((m) => m.asin)))
    const authorGaps = await findAuthorGaps(accessToken, library.books, seriesGapAsins)

    return NextResponse.json({
      seriesGaps,
      authorGaps,
      scannedAt: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/gaps]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
