import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

type Action = 'add' | 'remove' | 'not_interested'

/**
 * POST /api/books/want
 * Body:
 *  {
 *    action: 'add' | 'remove' | 'not_interested',
 *    asin?: string,
 *    // Optional catalog fields when adding from Upcoming (creates books row if needed)
 *    title?: string,
 *    authors?: string[],
 *    series_name?: string,
 *    series_position?: number | string | null,
 *    cover_url?: string | null,
 *    release_date?: string | null,
 *    preorder_url?: string | null,
 *  }
 *
 * - add: sets want_to_read=true, not_interested=false; upserts books + user_books
 * - remove: sets want_to_read=false (keeps row; does not delete owned books)
 * - not_interested: sets not_interested=true, want_to_read=false (dismiss from Want list)
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const action = (typeof body?.action === 'string' ? body.action.trim() : '') as Action
    let asin = typeof body?.asin === 'string' ? body.asin.trim() : ''

    if (!['add', 'remove', 'not_interested'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'add' | 'remove' | 'not_interested'" },
        { status: 400 }
      )
    }
    if (!asin) {
      return NextResponse.json({ error: 'asin is required' }, { status: 400 })
    }

    const service = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const now = new Date().toISOString()

    // Ensure books row exists when adding from Upcoming
    if (action === 'add') {
      const title =
        typeof body?.title === 'string' && body.title.trim()
          ? body.title.trim()
          : null
      const authors = Array.isArray(body?.authors)
        ? body.authors.filter((a: unknown) => typeof a === 'string')
        : typeof body?.author === 'string'
          ? [body.author]
          : []
      const seriesName =
        typeof body?.series_name === 'string'
          ? body.series_name
          : typeof body?.series === 'string'
            ? body.series
            : null
      const seriesPositionRaw = body?.series_position ?? body?.seriesNumber ?? null
      const seriesPosition =
        seriesPositionRaw == null || seriesPositionRaw === ''
          ? null
          : Number(seriesPositionRaw)
      const coverUrl =
        typeof body?.cover_url === 'string'
          ? body.cover_url
          : typeof body?.coverUrl === 'string'
            ? body.coverUrl
            : null
      const releaseDate =
        typeof body?.release_date === 'string'
          ? body.release_date.slice(0, 10)
          : typeof body?.releaseDate === 'string'
            ? body.releaseDate.slice(0, 10)
            : null

      const { data: existingBook } = await service
        .from('books')
        .select('id, asin, title')
        .eq('asin', asin)
        .maybeSingle()

      if (!existingBook) {
        if (!title) {
          return NextResponse.json(
            { error: 'title is required when creating a new book from Upcoming' },
            { status: 400 }
          )
        }
        const bookRow: Record<string, unknown> = {
          asin,
          title,
          authors: authors.length ? authors : null,
          series_name: seriesName,
          series_position:
            seriesPosition != null && Number.isFinite(seriesPosition)
              ? seriesPosition
              : null,
          cover_url: coverUrl,
          release_date: releaseDate,
          updated_at: now,
        }
        const { error: bookErr } = await service
          .from('books')
          .upsert(bookRow, { onConflict: 'asin' })
        if (bookErr) {
          console.error('[books/want] books upsert', bookErr.message)
          return NextResponse.json({ error: bookErr.message }, { status: 500 })
        }
      } else {
        // Soft-fill missing metadata without clobbering good data
        const patch: Record<string, unknown> = { updated_at: now }
        if (coverUrl) patch.cover_url = coverUrl
        if (releaseDate) patch.release_date = releaseDate
        if (seriesName) patch.series_name = seriesName
        if (seriesPosition != null && Number.isFinite(seriesPosition)) {
          patch.series_position = seriesPosition
        }
        if (Object.keys(patch).length > 1) {
          await service.from('books').update(patch).eq('asin', asin)
        }
      }

      // If series_releases has a better preorder_url / release_date, mirror release_date onto books
      const { data: release } = await service
        .from('series_releases')
        .select('preorder_url, release_date, cover_url, title, authors, series_name, series_position')
        .eq('asin', asin)
        .maybeSingle()
      if (release) {
        const mirror: Record<string, unknown> = { updated_at: now }
        if (release.release_date) mirror.release_date = release.release_date
        if (release.cover_url) mirror.cover_url = release.cover_url
        if (Object.keys(mirror).length > 1) {
          await service.from('books').update(mirror).eq('asin', asin)
        }
      }
    }

    const { data: book } = await service
      .from('books')
      .select('id, asin')
      .eq('asin', asin)
      .maybeSingle()

    if (!book?.id) {
      return NextResponse.json(
        { error: 'Book catalog row missing — provide title when adding from Upcoming' },
        { status: 404 }
      )
    }

    const { data: existing } = await service
      .from('user_books')
      .select('id, status, want_to_read, not_interested, purchase_date')
      .eq('user_id', user.id)
      .eq('asin', asin)
      .maybeSingle()

    let wantPatch: Record<string, unknown>
    if (action === 'add') {
      wantPatch = {
        want_to_read: true,
        not_interested: false,
        status_source: 'user',
        updated_at: now,
      }
    } else if (action === 'not_interested') {
      wantPatch = {
        want_to_read: false,
        not_interested: true,
        status_source: 'user',
        updated_at: now,
      }
    } else {
      // remove from want list only
      wantPatch = {
        want_to_read: false,
        status_source: 'user',
        updated_at: now,
      }
    }

    let userBook
    if (existing?.id) {
      const { data, error } = await service
        .from('user_books')
        .update(wantPatch)
        .eq('id', existing.id)
        .select(
          'id, asin, status, want_to_read, not_interested, purchase_date, status_source, updated_at'
        )
        .single()
      if (error) {
        // Migration 005 not applied yet
        if (
          error.message?.includes('want_to_read') ||
          error.message?.includes('not_interested')
        ) {
          return NextResponse.json(
            {
              error:
                'Want-to-read columns not available yet — apply migration 005_want_to_read_and_not_interested.sql',
              code: 'MIGRATION_REQUIRED',
            },
            { status: 503 }
          )
        }
        console.error('[books/want] update', error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userBook = data
    } else {
      if (action !== 'add') {
        return NextResponse.json(
          { error: 'Book not in your library' },
          { status: 404 }
        )
      }
      const insertRow = {
        user_id: user.id,
        book_id: book.id,
        asin,
        status: 'unstarted',
        want_to_read: true,
        not_interested: false,
        status_source: 'user',
        purchase_date: null,
      }
      const { data, error } = await service
        .from('user_books')
        .insert(insertRow)
        .select(
          'id, asin, status, want_to_read, not_interested, purchase_date, status_source, updated_at'
        )
        .single()
      if (error) {
        if (
          error.message?.includes('want_to_read') ||
          error.message?.includes('not_interested')
        ) {
          return NextResponse.json(
            {
              error:
                'Want-to-read columns not available yet — apply migration 005_want_to_read_and_not_interested.sql',
              code: 'MIGRATION_REQUIRED',
            },
            { status: 503 }
          )
        }
        console.error('[books/want] insert', error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      userBook = data
    }

    return NextResponse.json({
      success: true,
      action,
      user_book: userBook,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/want]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
