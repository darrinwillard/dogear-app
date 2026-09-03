import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/books/rating
 * Body: { asin: string, rating: number }
 *
 * User-owned rating write, half-star increments (1-5 in 0.5 steps).
 * This route was referenced by the client (LibraryClient.setRating) since
 * the half-star rating feature shipped but never actually existed — ratings
 * appeared to save optimistically in the UI then silently reverted on the
 * resulting 404. This is the missing implementation.
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
    const rating = typeof body?.rating === 'number' ? body.rating : null

    if (!asin || rating == null) {
      return NextResponse.json(
        { error: 'asin and rating are required' },
        { status: 400 }
      )
    }

    // Half-star increments only, 0.5 - 5.0
    const rounded = Math.round(rating * 2) / 2
    if (rounded < 0.5 || rounded > 5) {
      return NextResponse.json(
        { error: 'rating must be between 0.5 and 5, in half-star increments' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('user_books')
      .update({ rating: rounded, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('asin', asin)
      .select('id, asin, rating, updated_at')
      .maybeSingle()

    if (error) {
      console.error('[books/rating]', error.message)
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
    console.error('[books/rating]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
