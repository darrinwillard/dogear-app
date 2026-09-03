import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/books/mark-external-read
 * Body: { asin: string, title: string, authors?: string[], seriesName?: string|null,
 *         seriesPosition?: number|null, coverUrl?: string|null }
 *
 * For "gap" books surfaced on Find Your Next Read → series/author gaps: titles
 * Audible's catalog knows about that the user doesn't own (no user_books row,
 * no book_id yet). Used when the user read the book outside Audible (Kindle,
 * physical, library) and wants to mark it read without an Audible purchase.
 *
 * Creates the books row if missing (upsert by asin), then creates/updates the
 * user_books row with status='completed', status_source='user_external' —
 * distinct from the normal 'user' source so it's clear this never came
 * through an Audible sync and won't be touched by sync's presence-guards.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const asin = typeof body?.asin === 'string' ? body.asin.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const authors: string[] = Array.isArray(body?.authors)
      ? body.authors.filter((a: unknown): a is string => typeof a === 'string')
      : []
    const seriesName = typeof body?.seriesName === 'string' ? body.seriesName : null
    const seriesPosition =
      typeof body?.seriesPosition === 'number' ? body.seriesPosition : null
    const coverUrl = typeof body?.coverUrl === 'string' ? body.coverUrl : null

    if (!asin || !title) {
      return NextResponse.json({ error: 'asin and title are required' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // 1. Ensure a books row exists for this ASIN (upsert-by-asin, don't
    //    clobber an existing row's richer data if one already exists).
    const { data: existingBook } = await supabase
      .from('books')
      .select('id')
      .eq('asin', asin)
      .maybeSingle()

    let bookId = existingBook?.id as string | undefined

    if (!bookId) {
      const { data: inserted, error: insertErr } = await supabase
        .from('books')
        .insert({
          asin,
          title,
          authors,
          series: seriesName,
          series_num: seriesPosition != null ? String(seriesPosition) : null,
          cover_url: coverUrl,
          updated_at: now,
        })
        .select('id')
        .single()
      if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
      }
      bookId = inserted.id
    }

    // 2. Upsert user_books — mark completed, external source, clear any
    //    stale want/almost-finished flags the same way the normal status
    //    route does.
    const { data: userBook, error: upsertErr } = await supabase
      .from('user_books')
      .upsert(
        {
          user_id: user.id,
          book_id: bookId,
          asin,
          status: 'completed',
          finished_at: now,
          updated_at: now,
        },
        { onConflict: 'user_id,asin' }
      )
      .select('id, asin, status, finished_at')
      .single()

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    // status_source / want_to_read columns may not exist pre-migration —
    // best-effort second update, non-fatal if it fails.
    try {
      await supabase
        .from('user_books')
        .update({ status_source: 'user_external', want_to_read: false })
        .eq('user_id', user.id)
        .eq('asin', asin)
    } catch {
      // ignore — columns may be missing on older schema
    }

    return NextResponse.json({ success: true, user_book: userBook })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/mark-external-read]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
