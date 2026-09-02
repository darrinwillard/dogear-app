import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { refreshAudibleAccessToken } from '@/lib/books/audible-auth'
import { refreshReleasesForUser } from '@/lib/books/releases-refresh'
import { mapUserBookToBook, type SupabaseUserBookRow } from '@/lib/books/map'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const BOOK_EMBED = `
  id, asin, title, authors, narrator, runtime_minutes,
  cover_url, series_name, series_position, publisher, release_date
`

const USER_BOOK_SELECT = `
  id, asin, purchase_date, status, rating, notes,
  started_at, finished_at, percent_complete, is_finished,
  almost_finished_dismissed_at, status_source, updated_at,
  book:books ( ${BOOK_EMBED} )
`

/**
 * POST /api/audible/releases
 * Refresh series_releases from Audible catalog for the signed-in user.
 *
 * Query: ?force=1 to bypass the weekly throttle.
 * This is intentionally separate from library sync — catalog release data
 * changes slowly and author scans are heavier than a library pull.
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createServerClient()
    const {
      data: { user },
    } = await supabaseServer.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const force =
      req.nextUrl.searchParams.get('force') === '1' ||
      req.nextUrl.searchParams.get('force') === 'true'

    const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // last_releases_synced_at is optional (migration 003)
    let profile: {
      audible_refresh_token: string | null
      last_releases_synced_at?: string | null
    } | null = null

    const full = await supabase
      .from('user_profiles')
      .select('audible_refresh_token, last_releases_synced_at')
      .eq('id', user.id)
      .single()

    if (full.error) {
      const base = await supabase
        .from('user_profiles')
        .select('audible_refresh_token')
        .eq('id', user.id)
        .single()
      if (base.error) throw new Error(base.error.message)
      profile = base.data
    } else {
      profile = full.data
    }

    if (!profile?.audible_refresh_token) {
      return NextResponse.json(
        { error: 'No Audible account connected' },
        { status: 400 }
      )
    }

    // Throttle: profile column if present, else max(updated_at) on audible-sourced rows
    let lastRefreshed: string | null = profile.last_releases_synced_at ?? null
    if (!lastRefreshed) {
      const { data: latest } = await supabase
        .from('series_releases')
        .select('updated_at')
        .in('source', ['audible_catalog', 'audible_sims'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      lastRefreshed = latest?.updated_at ?? null
    }

    if (!force && lastRefreshed) {
      const last = new Date(lastRefreshed).getTime()
      const ageMs = Date.now() - last
      const weekMs = 7 * 24 * 60 * 60 * 1000
      if (Number.isFinite(last) && ageMs < weekMs) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: 'throttled',
          message:
            'Release catalog was refreshed within the last 7 days. Pass ?force=1 to run again.',
          last_releases_synced_at: lastRefreshed,
          age_hours: Math.round(ageMs / 3600000),
        })
      }
    }

    const { accessToken } = await refreshAudibleAccessToken(
      profile.audible_refresh_token
    )

    // Load library books for followed-series + read-author scope
    const { data: userBooks, error: ubErr } = await supabase
      .from('user_books')
      .select(USER_BOOK_SELECT)
      .eq('user_id', user.id)

    if (ubErr) {
      throw new Error(`Failed to load library: ${ubErr.message}`)
    }

    const books = ((userBooks || []) as SupabaseUserBookRow[]).map(
      mapUserBookToBook
    )

    if (books.length === 0) {
      return NextResponse.json(
        {
          error:
            'Library is empty — run Audible library Sync first so we know which series/authors to follow.',
        },
        { status: 400 }
      )
    }

    const result = await refreshReleasesForUser({
      supabase,
      userId: user.id,
      accessToken,
      books,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[audible-releases]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** GET — lightweight status for UI */
export async function GET() {
  try {
    const supabaseServer = await createServerClient()
    const {
      data: { user },
    } = await supabaseServer.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const full = await supabase
      .from('user_profiles')
      .select('last_releases_synced_at, audible_refresh_token')
      .eq('id', user.id)
      .maybeSingle()

    let connected = false
    let last_releases_synced_at: string | null = null
    if (!full.error && full.data) {
      connected = Boolean(full.data.audible_refresh_token)
      last_releases_synced_at = full.data.last_releases_synced_at ?? null
    } else {
      const base = await supabase
        .from('user_profiles')
        .select('audible_refresh_token')
        .eq('id', user.id)
        .maybeSingle()
      connected = Boolean(base.data?.audible_refresh_token)
    }

    if (!last_releases_synced_at) {
      const { data: latest } = await supabase
        .from('series_releases')
        .select('updated_at')
        .in('source', ['audible_catalog', 'audible_sims'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      last_releases_synced_at = latest?.updated_at ?? null
    }

    const { count } = await supabase
      .from('series_releases')
      .select('id', { count: 'exact', head: true })

    return NextResponse.json({
      connected,
      last_releases_synced_at,
      series_releases_count: count ?? 0,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
