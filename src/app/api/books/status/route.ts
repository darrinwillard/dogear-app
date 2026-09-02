import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapUiStatusToDb } from '@/lib/books/map'
import type { DbStatus } from '@/lib/books/types'

export const dynamic = 'force-dynamic'

const ALLOWED: DbStatus[] = ['unstarted', 'in_progress', 'completed']

/**
 * PATCH /api/books/status
 * Body: { asin: string, status: 'unstarted'|'in_progress'|'completed' | UI status }
 *
 * User-owned status write. Sets finished_at/started_at and status_source='user'.
 * Sync route must never touch these fields.
 */
export async function PATCH(req: NextRequest) {
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
    const rawStatus = typeof body?.status === 'string' ? body.status.trim() : ''

    if (!asin || !rawStatus) {
      return NextResponse.json(
        { error: 'asin and status are required' },
        { status: 400 }
      )
    }

    const status: DbStatus = ALLOWED.includes(rawStatus as DbStatus)
      ? (rawStatus as DbStatus)
      : mapUiStatusToDb(rawStatus)

    if (!ALLOWED.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      status,
      status_source: 'user',
      updated_at: now,
    }

    if (status === 'completed') {
      patch.finished_at = now
      // Keep any existing started_at; do not invent one here
    } else if (status === 'in_progress') {
      // Coalesce started_at in SQL-ish fashion: only set when currently null
      // (fetch first so we don't clobber an earlier start)
      const { data: existing } = await supabase
        .from('user_books')
        .select('started_at')
        .eq('user_id', user.id)
        .eq('asin', asin)
        .maybeSingle()
      if (!existing?.started_at) {
        patch.started_at = now
      }
      patch.finished_at = null
    } else {
      // unstarted
      patch.started_at = null
      patch.finished_at = null
    }

    const { data, error } = await supabase
      .from('user_books')
      .update(patch)
      .eq('user_id', user.id)
      .eq('asin', asin)
      .select(
        'id, asin, status, rating, started_at, finished_at, status_source, percent_complete, is_finished, almost_finished_dismissed_at, updated_at'
      )
      .maybeSingle()

    if (error) {
      console.error('[books/status]', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Book not found in your library' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, user_book: data })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[books/status]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
