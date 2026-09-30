import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const NYT_API_KEY = process.env.NYT_API_KEY
const NYT_BASE = 'https://api.nytimes.com/svc/books/v3'

// In-memory cache — NYT lists update weekly, no need to hit the API on
// every page load. Keyed by list name. Resets on cold start (fine — the
// free tier allows 500 calls/day, this just avoids burning quota on
// repeat visits within a deploy's lifetime).
const CACHE_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours
const cache = new Map<string, { at: number; data: unknown }>()

export interface NytBestsellerBook {
  rank: number
  rank_last_week: number
  weeks_on_list: number
  title: string
  author: string
  description: string
  publisher: string
  book_image: string | null
  amazon_product_url: string | null
  primary_isbn13: string | null
}

export interface NytListsResponse {
  lists: { list_name: string; display_name: string; list_name_encoded: string }[]
}

/** GET /api/books/bestsellers?list=combined-print-and-e-book-fiction
 *  GET /api/books/bestsellers?names=1  — returns the full list-of-lists instead
 */
export async function GET(req: NextRequest) {
  if (!NYT_API_KEY) {
    return NextResponse.json(
      { error: 'NYT_API_KEY not configured on the server' },
      { status: 503 }
    )
  }

  const { searchParams } = new URL(req.url)
  const wantNames = searchParams.get('names') === '1'
  const listName = searchParams.get('list') || 'combined-print-and-e-book-fiction'

  const cacheKey = wantNames ? '__names__' : listName
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.data)
  }

  try {
    if (wantNames) {
      const res = await fetch(`${NYT_BASE}/lists/names.json?api-key=${NYT_API_KEY}`)
      if (!res.ok) {
        return NextResponse.json(
          { error: `NYT API error: ${res.status}` },
          { status: 502 }
        )
      }
      const json = await res.json()
      const lists = (json.results || []).map(
        (r: { list_name: string; display_name: string; list_name_encoded: string }) => ({
          list_name: r.list_name,
          display_name: r.display_name,
          list_name_encoded: r.list_name_encoded,
        })
      )
      const payload: NytListsResponse = { lists }
      cache.set(cacheKey, { at: Date.now(), data: payload })
      return NextResponse.json(payload)
    }

    const res = await fetch(
      `${NYT_BASE}/lists/current/${encodeURIComponent(listName)}.json?api-key=${NYT_API_KEY}`
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: `NYT API error: ${res.status}` },
        { status: 502 }
      )
    }
    const json = await res.json()
    const results = json.results || {}
    const books: NytBestsellerBook[] = (results.books || []).map(
      (b: Record<string, unknown>) => ({
        rank: b.rank,
        rank_last_week: b.rank_last_week,
        weeks_on_list: b.weeks_on_list,
        title: b.title,
        author: b.author,
        description: b.description,
        publisher: b.publisher,
        book_image: b.book_image || null,
        amazon_product_url: b.amazon_product_url || null,
        primary_isbn13: b.primary_isbn13 || null,
      })
    )
    const payload = {
      list_name: results.list_name,
      display_name: results.display_name,
      list_name_encoded: results.list_name_encoded,
      published_date: results.published_date,
      bestsellers_date: results.bestsellers_date,
      updated: results.updated,
      books,
    }
    cache.set(cacheKey, { at: Date.now(), data: payload })
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch NYT bestsellers' },
      { status: 500 }
    )
  }
}
