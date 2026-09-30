#!/usr/bin/env node
/**
 * Offline test of Audible library pagination + batched Supabase sync writes.
 * Mirrors src/app/api/audible/sync/route.ts without needing a Next.js session.
 *
 * Usage:
 *   NODE_PATH=./node_modules node scripts/test-sync-batch-pagination.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PAGE_SIZE = 1000
const BOOK_UPSERT_CHUNK = 200
const USER_BOOK_CHUNK = 200
const PRELOAD_CHUNK = 200

const RESPONSE_GROUPS = [
  'product_desc',
  'product_attrs',
  'product_extended_attrs',
  'contributors',
  'media',
  'series',
  'percent_complete',
  'is_finished',
  'listening_status',
  'relationships',
  'category_ladders',
].join(',')

function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function refreshAccessToken(refreshTokenJson) {
  const tokens = JSON.parse(refreshTokenJson)
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
  const data = await refreshResponse.json()
  if (!data.access_token) throw new Error(`token refresh failed: ${JSON.stringify(data)}`)
  return data.access_token
}

async function fetchLibraryPage(accessToken, page, numResults) {
  const params = new URLSearchParams({
    response_groups: RESPONSE_GROUPS,
    num_results: String(numResults),
    page: String(page),
  })
  const res = await fetch(`https://api.audible.com/1.0/library?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`library page ${page} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  return data.items || []
}

async function fetchAllLibraryItems(accessToken, pageSize = PAGE_SIZE) {
  const items = []
  const seen = new Set()
  let page = 1
  while (page <= 100) {
    const pageItems = await fetchLibraryPage(accessToken, page, pageSize)
    for (const it of pageItems) {
      if (it.asin && seen.has(it.asin)) continue
      if (it.asin) seen.add(it.asin)
      items.push(it)
    }
    if (pageItems.length < pageSize) break
    page++
  }
  return { items, pagesFetched: page, unique: seen.size }
}

function readCover(item) {
  const images = item.product_images
  if (!images || typeof images !== 'object') return undefined
  return (
    images['500'] ||
    images['1024'] ||
    images['300'] ||
    Object.values(images).find((v) => typeof v === 'string' && v.trim()) ||
    undefined
  )
}

function readPercent(item) {
  const nested = item.listening_status?.percent_complete
  const raw = item.percent_complete ?? nested
  if (raw == null && item.percent_complete === undefined && nested === undefined) return undefined
  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (typeof n !== 'number' || Number.isNaN(n)) return null
  return Math.min(100, Math.max(0, n))
}

function readFinished(item) {
  if (!Object.prototype.hasOwnProperty.call(item, 'is_finished')) return undefined
  const raw = item.is_finished
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
  return undefined
}

async function main() {
  const started = Date.now()
  console.log('=== DogEar sync batch + pagination test ===')

  // Baseline DB counts
  const { data: profiles } = await sb
    .from('user_profiles')
    .select('id, audible_refresh_token, last_synced_at')
    .not('audible_refresh_token', 'is', null)
    .limit(1)
  const profile = profiles?.[0]
  if (!profile) throw new Error('No connected Audible profile found')
  const userId = profile.id

  const beforeUb = await sb
    .from('user_books')
    .select('id, asin, status, rating, want_to_read, not_interested, percent_complete, is_finished, purchase_date, book_id', { count: 'exact' })
    .eq('user_id', userId)
  const beforeCount = beforeUb.count ?? beforeUb.data?.length ?? 0
  const beforeByAsin = new Map((beforeUb.data || []).map((r) => [r.asin, r]))
  console.log('BEFORE user_books:', beforeCount)

  const { count: beforeBooksCount } = await sb
    .from('books')
    .select('id', { count: 'exact', head: true })
  console.log('BEFORE books table:', beforeBooksCount)

  const accessToken = await refreshAccessToken(profile.audible_refresh_token)

  // --- Task 2 proof: single-page vs paginated ---
  const singlePage = await fetchLibraryPage(accessToken, 1, 1000)
  console.log('Single-page num_results=1000 items:', singlePage.length)

  // Force multi-page path with small page size to prove pagination works even when total < 1000
  const pagedSmall = await fetchAllLibraryItems(accessToken, 200)
  console.log(
    'Paginated page_size=200 items:',
    pagedSmall.items.length,
    'pages:',
    pagedSmall.pagesFetched,
    'unique:',
    pagedSmall.unique
  )

  const pagedFull = await fetchAllLibraryItems(accessToken, 1000)
  console.log(
    'Paginated page_size=1000 items:',
    pagedFull.items.length,
    'pages:',
    pagedFull.pagesFetched,
    'unique:',
    pagedFull.unique
  )

  if (pagedSmall.unique !== pagedFull.unique) {
    throw new Error(
      `Pagination mismatch: small-page unique=${pagedSmall.unique} full-page unique=${pagedFull.unique}`
    )
  }
  if (pagedSmall.pagesFetched < 2 && pagedSmall.unique > 200) {
    throw new Error('Expected multiple pages when page_size=200 and library > 200')
  }
  // Prove multi-page retrieval returns the full set (not capped at first page only)
  const firstPageOnly = await fetchLibraryPage(accessToken, 1, 200)
  if (pagedSmall.unique <= firstPageOnly.length && pagedSmall.unique > 200) {
    throw new Error('Pagination failed to retrieve beyond first page')
  }
  console.log(
    'Pagination proof OK: first page 200 got',
    firstPageOnly.length,
    'full multi-page got',
    pagedSmall.unique
  )

  const items = pagedFull.items
  const asins = items.map((i) => i.asin).filter(Boolean)
  const now = new Date().toISOString()

  // Build book upserts (presence-guarded like route)
  const bookUpserts = []
  const progressByAsin = new Map()
  for (const item of items) {
    const asin = item.asin
    if (!asin) continue
    const narrators = (item.narrators || []).map((n) => n.name).filter(Boolean)
    const authors = (item.authors || []).map((a) => a.name).filter(Boolean)
    const row = {
      asin,
      title: item.title || 'Unknown',
      authors,
      narrator: narrators.join(', ') || null,
      runtime_minutes: item.runtime_length_min || null,
      updated_at: now,
    }
    if (Array.isArray(item.series) && item.series[0]?.title) {
      row.series_name = String(item.series[0].title).trim()
      const seq = item.series[0].sequence
      if (seq != null && /^\d+(\.\d+)?$/.test(String(seq).trim())) {
        row.series_position = Number(seq)
      }
    }
    const cover = readCover(item)
    if (cover) row.cover_url = cover
    if (item.publisher_name) row.publisher = item.publisher_name
    const summary = item.publisher_summary || item.merchandising_summary
    if (summary) {
      row.summary = String(summary)
        .replace(/<br\s*\/?>/gi, '\n\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&/g, '&')
        .replace(/'|'/g, "'")
        .replace(/"/g, '"')
        .replace(/[ \t]+/g, ' ')
        .trim()
    }
    const release =
      item.release_date ||
      (item.publication_datetime ? String(item.publication_datetime).slice(0, 10) : null)
    if (release) row.release_date = release
    bookUpserts.push(row)

    const progress = {
      purchase_date: item.purchase_date
        ? new Date(item.purchase_date).toISOString().split('T')[0]
        : null,
    }
    const percent = readPercent(item)
    const finished = readFinished(item)
    if (percent !== undefined) progress.percent_complete = percent
    if (finished !== undefined) progress.is_finished = finished
    progressByAsin.set(asin, progress)
  }

  // Batch upsert books
  const booksByAsin = new Map()
  let booksUpserted = 0
  const tBooks = Date.now()
  for (const chunk of chunkArray(bookUpserts, BOOK_UPSERT_CHUNK)) {
    const { data, error } = await sb
      .from('books')
      .upsert(chunk, { onConflict: 'asin' })
      .select('id, asin')
    if (error) throw error
    for (const b of data || []) booksByAsin.set(b.asin, b)
    booksUpserted += data?.length || 0
  }
  console.log(`books upserted=${booksUpserted} in ${Date.now() - tBooks}ms (chunk=${BOOK_UPSERT_CHUNK})`)

  // Fill any missing ids
  const missing = asins.filter((a) => !booksByAsin.get(a)?.id)
  for (const chunk of chunkArray(missing, PRELOAD_CHUNK)) {
    const { data } = await sb.from('books').select('id, asin').in('asin', chunk)
    for (const row of data || []) booksByAsin.set(row.asin, row)
  }

  // Build user_books inserts/updates — NEVER touch status/want flags on existing
  const toInsert = []
  const toUpdate = []
  for (const asin of asins) {
    const book = booksByAsin.get(asin)
    if (!book?.id) continue
    const progress = progressByAsin.get(asin)
    if (!progress) continue
    const existing = beforeByAsin.get(asin)
    const progressPatch = {
      book_id: book.id,
      progress_synced_at: now,
      updated_at: now,
    }
    if (progress.percent_complete !== undefined) {
      progressPatch.percent_complete = progress.percent_complete
    }
    if (progress.is_finished !== undefined) {
      progressPatch.is_finished = progress.is_finished
    }
    if (progress.purchase_date) progressPatch.purchase_date = progress.purchase_date

    if (!existing) {
      toInsert.push({
        user_id: userId,
        book_id: book.id,
        asin,
        status: 'unstarted',
        purchase_date: progress.purchase_date,
        want_to_read: false,
        not_interested: false,
        ...(progress.percent_complete !== undefined
          ? { percent_complete: progress.percent_complete }
          : {}),
        ...(progress.is_finished !== undefined ? { is_finished: progress.is_finished } : {}),
        progress_synced_at: now,
      })
    } else {
      toUpdate.push({
        id: existing.id,
        user_id: userId,
        asin,
        ...progressPatch,
      })
    }
  }

  let inserted = 0
  const tIns = Date.now()
  for (const chunk of chunkArray(toInsert, USER_BOOK_CHUNK)) {
    if (!chunk.length) continue
    const { data, error } = await sb
      .from('user_books')
      .upsert(chunk, { onConflict: 'user_id,asin' })
      .select('id')
    if (error) throw error
    inserted += data?.length || 0
  }
  console.log(`user_books inserted=${inserted} in ${Date.now() - tIns}ms`)

  let updated = 0
  const tUpd = Date.now()
  for (const chunk of chunkArray(toUpdate, USER_BOOK_CHUNK)) {
    if (!chunk.length) continue
    const { data, error } = await sb
      .from('user_books')
      .upsert(chunk, { onConflict: 'user_id,asin' })
      .select('id')
    if (error) throw error
    updated += data?.length || 0
  }
  console.log(
    `user_books updated=${updated} in ${Date.now() - tUpd}ms (chunk=${USER_BOOK_CHUNK}, bulk upsert not per-row)`
  )

  // Verify protected fields unchanged
  const afterUb = await sb
    .from('user_books')
    .select('id, asin, status, rating, want_to_read, not_interested, percent_complete, is_finished, purchase_date')
    .eq('user_id', userId)
  const afterByAsin = new Map((afterUb.data || []).map((r) => [r.asin, r]))
  let protectedMismatches = 0
  for (const [asin, before] of beforeByAsin.entries()) {
    const after = afterByAsin.get(asin)
    if (!after) {
      console.error('MISSING after sync', asin)
      protectedMismatches++
      continue
    }
    if (before.status !== after.status) {
      console.error('status clobber', asin, before.status, '->', after.status)
      protectedMismatches++
    }
    if (before.rating !== after.rating) {
      console.error('rating clobber', asin, before.rating, '->', after.rating)
      protectedMismatches++
    }
    if (Boolean(before.want_to_read) !== Boolean(after.want_to_read)) {
      console.error('want_to_read clobber', asin)
      protectedMismatches++
    }
    if (Boolean(before.not_interested) !== Boolean(after.not_interested)) {
      console.error('not_interested clobber', asin)
      protectedMismatches++
    }
  }

  const afterCount = afterUb.data?.length ?? 0
  const { count: afterBooksCount } = await sb
    .from('books')
    .select('id', { count: 'exact', head: true })

  // Stamp last_synced like the route
  await sb.from('user_profiles').update({ last_synced_at: now }).eq('id', userId)

  const summary = {
    ok: protectedMismatches === 0 && afterCount >= beforeCount,
    duration_ms: Date.now() - started,
    library_items_audible: items.length,
    single_page_1000: singlePage.length,
    multi_page_200_unique: pagedSmall.unique,
    multi_page_200_pages: pagedSmall.pagesFetched,
    before_user_books: beforeCount,
    after_user_books: afterCount,
    before_books: beforeBooksCount,
    after_books: afterBooksCount,
    books_upserted: booksUpserted,
    user_books_inserted: inserted,
    user_books_updated: updated,
    protected_field_mismatches: protectedMismatches,
  }
  console.log('SUMMARY', JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
