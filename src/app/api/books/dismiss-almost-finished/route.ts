import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/books/dismiss-almost-finished
 * Body: { asin: string }
 *
 * Snoozes the "Mark as read?" prompt for a near-finished title without
 * changing status. Sets almost_finished_dismissed_at = now().
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
    if (!asin) {
      return NextResponse.json({ error: 'asin is required' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('user_books')
      .update({
        almost_finished_dismissed_at: now,
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('asin', asin)
      .select('id, asin, almost_finished_dismissed_at, status, percent_complete, is_finished')
      .maybeSingle()

    if (error) {
      console.error('[books/dismiss-almost-finished]', error.message)
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
    console.error('[books/dismiss-almost-finished]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
