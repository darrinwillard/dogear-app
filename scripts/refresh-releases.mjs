/**
 * One-shot: refresh series_releases from Audible catalog for the primary user.
 * Usage: node scripts/refresh-releases.mjs
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load .env.local
const envPath = resolve(root, '.env.local')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// Use tsx/ts-node if available; otherwise inline minimal port via dynamic import of built code.
// For now, reimplement the critical path in plain JS so we can seed without a Next build.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

function parseSeriesSequence(raw) {
  if (raw == null || raw === '') return { position: null, raw: null, range: false }
  const s = String(raw).trim()
  if (s.includes('-') || s.includes('–')) return { position: null, raw: s, range: true }
  const n = parseFloat(s)
  return { position: Number.isFinite(n) ? n : null, raw: s, range: false }
}

function normKey(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|series|novel|novels|chronicles|saga|trilogy|omnibus)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function seriesNamesMatch(a, b) {
  const na = normKey(a)
  const nb = normKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const ta = new Set(na.split(' ').filter((t) => t.length > 2))
  const tb = new Set(nb.split(' ').filter((t) => t.length > 2))
  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  if (overlap >= 2) return true
  if (overlap === 1 && (ta.size === 1 || tb.size === 1)) return true
  return false
}

function authorNamesMatch(a, b) {
  const na = normKey(a)
  const nb = normKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = na.split(' ')
  const tb = nb.split(' ')
  if (ta.length >= 2 && tb.length >= 2) {
    if (ta[ta.length - 1] === tb[tb.length - 1] && ta[0][0] === tb[0][0]) return true
  }
  return na.includes(nb) || nb.includes(na)
}

function ymd(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function cleanAuthors(authors) {
  return (authors || [])
    .map((a) => (a.name || '').trim())
    .filter(Boolean)
    .filter((n) => !/übersetzer|translator|herausgeber|editor|foreword|afterword/i.test(n))
}

function pickCover(productImages) {
  if (!productImages || typeof productImages !== 'object') return null
  const preferred =
    productImages['500'] ||
    productImages['1024'] ||
    productImages['300'] ||
    productImages['0'] ||
    productImages['100'] ||
    productImages['60']
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim()
  for (const v of Object.values(productImages)) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function normalize(p, source) {
  if (!p?.asin || !p.title) return null
  const lang = (p.language || '').toLowerCase()
  if (lang && lang !== 'english' && !lang.startsWith('en')) return null
  const title = p.title.toLowerCase()
  if (title.includes('podcast') || title.includes('the chris voss show')) return null
  const authors = cleanAuthors(p.authors)
  if (!authors.length) return null
  const series0 = Array.isArray(p.series) ? p.series[0] : undefined
  const parsed = parseSeriesSequence(series0?.sequence)
  const releaseDate =
    ymd(p.release_date) || ymd(p.issue_date) || ymd(p.publication_datetime) || ymd(p.date_first_available)
  return {
    asin: p.asin,
    title: p.title.trim(),
    authors,
    seriesName: series0?.title?.trim() || null,
    seriesPosition: parsed.range ? null : parsed.position,
    releaseDate,
    source,
    preorderUrl: `https://www.audible.com/pd/${p.asin}`,
    coverUrl: pickCover(p.product_images),
  }
}

function releaseStatus(releaseDate) {
  if (!releaseDate) return 'announced'
  const end = new Date(releaseDate + 'T23:59:59Z')
  return end.getTime() >= Date.now() ? 'upcoming' : 'released'
}

function inWindow(releaseDate) {
  if (!releaseDate) return true
  const d = new Date(releaseDate + 'T12:00:00Z')
  const days = (d.getTime() - Date.now()) / 86400000
  if (days < -60) return false
  if (days > 366 * 3) return false
  return true
}

function encodeNotes(kind) {
  const tag = `[interest:${kind}]`
  const human =
    kind === 'author'
      ? 'New from an author you have read'
      : kind === 'both'
        ? 'Matches a series you follow and an author you have read'
        : 'Next / upcoming in a series you follow'
  return `${tag} ${human}`
}

async function audibleGet(token, path) {
  const res = await fetch(`https://api.audible.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

async function main() {
  const { data: profiles } = await sb
    .from('user_profiles')
    .select('id, audible_refresh_token')
    .not('audible_refresh_token', 'is', null)
    .limit(1)
  const profile = profiles?.[0]
  if (!profile) throw new Error('No profile with Audible token')
  const userId = profile.id
  console.log('user', userId)

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
  const accessToken = (await refreshResponse.json()).access_token
  if (!accessToken) throw new Error('token refresh failed')

  const { data: rows } = await sb
    .from('user_books')
    .select(
      `status, finished_at, asin, book:books ( title, authors, series_name, series_position, asin )`
    )
    .eq('user_id', userId)

  const bySeries = new Map()
  const ownedAsins = new Set()
  const readAuthorCounts = new Map()

  for (const r of rows || []) {
    if (r.asin) ownedAsins.add(r.asin)
    if (r.book?.asin) ownedAsins.add(r.book.asin)
    const sn = r.book?.series_name
    if (sn) {
      if (!bySeries.has(sn)) {
        bySeries.set(sn, {
          name: sn,
          read: 0,
          total: 0,
          maxPos: 0,
          lastRead: null,
          author: r.book?.authors?.[0] || 'Unknown',
          topAsin: null,
        })
      }
      const s = bySeries.get(sn)
      s.total++
      if (r.status === 'completed') {
        s.read++
        const fd = r.finished_at
        if (fd && (!s.lastRead || fd > s.lastRead)) s.lastRead = fd
      }
      const pos = Number(r.book?.series_position) || 0
      if (pos >= s.maxPos) {
        s.maxPos = pos
        s.topAsin = r.book?.asin || r.asin
      }
    }
    if (r.status === 'completed') {
      for (const a of r.book?.authors || []) {
        if (!a || /^various$/i.test(a)) continue
        readAuthorCounts.set(a, (readAuthorCounts.get(a) || 0) + 1)
      }
    }
  }

  const RECENT = 540
  const followed = [...bySeries.values()].filter((s) => {
    if (s.read < 1) return false
    if (s.read < s.total) return true // in progress
    // caught up on owned books — still follow if substantial investment
    if (s.lastRead) {
      const days = (Date.now() - new Date(s.lastRead).getTime()) / 86400000
      if (days > RECENT) return false
    }
    return s.read >= 2 || s.maxPos >= 2 || s.total >= 2 || !!s.lastRead
  })
  console.log('followed series', followed.length, followed.slice(0, 8).map((s) => s.name))

  const authorsChosen = []
  for (const s of followed) {
    if (s.author && !authorsChosen.some((a) => authorNamesMatch(a, s.author))) {
      authorsChosen.push(s.author)
    }
  }
  const sortedAuthors = [...readAuthorCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [name] of sortedAuthors) {
    if (!authorsChosen.some((a) => authorNamesMatch(a, name))) authorsChosen.push(name)
    if (authorsChosen.length >= 35) break
  }
  console.log('authors to search', authorsChosen.length)

  const RG =
    'contributors,media,product_attrs,product_desc,product_extended_attrs,series,product_details'
  const IMAGE_SIZES = '300,500,1024'
  const byAsin = new Map()

  function merge(rel, kind, matchedSeries) {
    const ex = byAsin.get(rel.asin)
    if (!ex) {
      byAsin.set(rel.asin, { ...rel, interestKind: kind, matchedSeries })
      return
    }
    let k = ex.interestKind
    if (k !== kind) k = 'both'
    byAsin.set(rel.asin, {
      ...ex,
      ...rel,
      interestKind: k,
      matchedSeries: matchedSeries || ex.matchedSeries,
      seriesName: rel.seriesName || ex.seriesName,
      seriesPosition: rel.seriesPosition ?? ex.seriesPosition,
    })
  }

  let seriesTried = 0
  for (const s of followed) {
    if (seriesTried >= 40) break
    if (!s.topAsin) continue
    seriesTried++
    try {
      for (const sim of ['NextInSameSeries', 'InTheSameSeries']) {
        const data = await audibleGet(
          accessToken,
          `/1.0/catalog/products/${encodeURIComponent(s.topAsin)}/sims?similarity_type=${sim}&num_results=${sim === 'NextInSameSeries' ? 10 : 20}&response_groups=${encodeURIComponent(RG)}&image_sizes=${IMAGE_SIZES}`
        )
        const products = data.similar_products || data.products || []
        for (const p of products) {
          const rel = normalize(p, 'audible_sims')
          if (!rel) continue
          if (ownedAsins.has(rel.asin)) continue
          const isNext = sim === 'NextInSameSeries'
          const seriesOk =
            isNext || (rel.seriesName ? seriesNamesMatch(rel.seriesName, s.name) : false)
          if (!seriesOk) continue
          if (!inWindow(rel.releaseDate)) continue
          if (
            !isNext &&
            rel.seriesPosition != null &&
            s.maxPos > 0 &&
            rel.seriesPosition <= s.maxPos &&
            releaseStatus(rel.releaseDate) === 'released'
          ) {
            continue
          }
          merge(rel, 'series', s.name)
        }
      }
      await new Promise((r) => setTimeout(r, 120))
    } catch (e) {
      console.warn('series fail', s.name, e.message)
    }
  }

  let authorsDone = 0
  for (const author of authorsChosen) {
    authorsDone++
    try {
      const params = new URLSearchParams({
        author,
        products_sort_by: '-ReleaseDate',
        num_results: '15',
        page: '0',
        response_groups: RG,
        image_sizes: IMAGE_SIZES,
      })
      const data = await audibleGet(accessToken, `/1.0/catalog/products?${params}`)
      for (const p of data.products || []) {
        const rel = normalize(p, 'audible_catalog')
        if (!rel) continue
        if (ownedAsins.has(rel.asin)) continue
        if (!rel.authors.some((a) => authorNamesMatch(a, author))) continue
        if (!inWindow(rel.releaseDate)) continue
        const matched =
          followed.find((s) => rel.seriesName && seriesNamesMatch(rel.seriesName, s.name))
            ?.name || null
        merge(rel, matched ? 'series' : 'author', matched)
      }
      await new Promise((r) => setTimeout(r, 150))
    } catch (e) {
      console.warn('author fail', author, e.message)
    }
  }

  console.log('candidates', byAsin.size)
  const withCover = [...byAsin.values()].filter((r) => r.coverUrl).length
  console.log('candidates with coverUrl', withCover)

  // Detect optional migration-003 columns once
  const optionalCols = []
  for (const col of ['cover_url', 'interest_kind', 'matched_series', 'language', 'content_type']) {
    const { error } = await sb.from('series_releases').select(col).limit(1)
    if (!error) optionalCols.push(col)
  }
  console.log('optional series_releases cols', optionalCols)

  const now = new Date().toISOString()
  let upserted = 0
  let errors = 0
  let booksMirrored = 0
  for (const r of byAsin.values()) {
    const row = {
      series_name: r.matchedSeries || r.seriesName || 'Standalone',
      series_position: r.seriesPosition,
      title: r.title,
      authors: r.authors,
      asin: r.asin,
      release_date: r.releaseDate,
      status: releaseStatus(r.releaseDate),
      source: r.source,
      preorder_url: r.preorderUrl,
      notes: encodeNotes(r.interestKind),
      updated_at: now,
      detected_at: now,
    }
    if (optionalCols.includes('cover_url') && r.coverUrl) row.cover_url = r.coverUrl
    if (optionalCols.includes('interest_kind')) row.interest_kind = r.interestKind
    if (optionalCols.includes('matched_series')) row.matched_series = r.matchedSeries
    try {
      const { data: existing } = await sb
        .from('series_releases')
        .select('id')
        .eq('asin', r.asin)
        .maybeSingle()
      if (existing?.id) {
        const { error } = await sb.from('series_releases').update(row).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data: byTitle } = await sb
          .from('series_releases')
          .select('id')
          .eq('series_name', row.series_name)
          .eq('title', row.title)
          .maybeSingle()
        if (byTitle?.id) {
          const { error } = await sb.from('series_releases').update(row).eq('id', byTitle.id)
          if (error) throw error
        } else {
          const { error } = await sb.from('series_releases').insert(row)
          if (error) throw error
        }
      }
      upserted++

      // Mirror cover onto books so Upcoming can join without migration 003
      if (r.coverUrl) {
        const { data: book } = await sb
          .from('books')
          .select('id, cover_url')
          .eq('asin', r.asin)
          .maybeSingle()
        if (book?.id) {
          if (book.cover_url !== r.coverUrl) {
            const { error: bErr } = await sb
              .from('books')
              .update({ cover_url: r.coverUrl, updated_at: now })
              .eq('id', book.id)
            if (!bErr) booksMirrored++
          }
        } else {
          const { error: bErr } = await sb.from('books').insert({
            asin: r.asin,
            title: r.title,
            authors: r.authors,
            cover_url: r.coverUrl,
            release_date: r.releaseDate,
            updated_at: now,
          })
          if (!bErr) booksMirrored++
        }
      }
    } catch (e) {
      errors++
      console.warn('upsert fail', r.title, e.message)
    }
  }
  console.log('books covers mirrored', booksMirrored)

  const sample = [...byAsin.values()]
    .sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'))
    .slice(0, 12)
  console.log(JSON.stringify({ upserted, errors, sample }, null, 2))

  const { count } = await sb.from('series_releases').select('id', { count: 'exact', head: true })
  console.log('table count', count)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
