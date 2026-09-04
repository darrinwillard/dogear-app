import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { findSeriesGaps, findAuthorGaps, loadPersistedGaps, persistGapResults } from '@/lib/books/gaps'
import { refreshAudibleAccessToken } from '@/lib/books/audible-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/books/gaps
 *
 * Returns PERSISTED scan results instantly (no Audible calls, no wait) —
 * fixes Darrin's 2026-09-03 report that scan results disappeared when he
 * came back to the app later. Pass ?rescan=1 to trigger a fresh Audible
 * catalog scan, which updates the persisted rows incrementally (books the
 * user now owns/marked-read drop out of `missing` automatically; newly
 * found gaps get added) rather than wiping everything and starting over.
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

    const rescan = req.nextUrl.searchParams.get('rescan') === '1'

    if (!rescan) {
      const persisted = await loadPersistedGaps(user.id)
      return NextResponse.json({
        seriesGaps: persisted.seriesGaps,
        authorGaps: persisted.authorGaps,
        scannedAt: persisted.lastScannedAt,
        fromCache: true,
      })
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

    const { gaps: seriesGaps, checkedNames: checkedSeriesNames } = await findSeriesGaps(
      accessToken,
      library.books
    )
    const seriesGapAsins = new Set(seriesGaps.flatMap((g) => g.missing.map((m) => m.asin)))
    const { gaps: authorGaps, checkedNames: checkedAuthorNames } = await findAuthorGaps(
      accessToken,
      library.books,
      seriesGapAsins
    )

    await persistGapResults(user.id, seriesGaps, authorGaps, checkedSeriesNames, checkedAuthorNames)

    return NextResponse.json({
      seriesGaps,
      authorGaps,
      scannedAt: new Date().toISOString(),
      fromCache: false,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/gaps]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
