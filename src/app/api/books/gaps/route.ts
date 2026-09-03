import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLibraryForCurrentUser } from '@/lib/books/queries'
import { findSeriesGaps, findAuthorGaps } from '@/lib/books/gaps'

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

    if (!profile?.audible_refresh_token) {
      return NextResponse.json(
        { error: 'Audible not connected — connect Audible in Settings first.' },
        { status: 400 }
      )
    }

    const tokens = JSON.parse(profile.audible_refresh_token)
    const refreshResponse = await fetch('https://api.amazon.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_name: 'Audible',
        app_version: '3.56.2',
        source_token: tokens.refresh_token,
        requested_token_type: 'access_token',
        source_token_type: 'refresh_token',
      }).toString(),
    })
    const refreshData = await refreshResponse.json()
    const accessToken = refreshData.access_token
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Token refresh failed — please reconnect Audible in Settings.' },
        { status: 401 }
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
