#!/usr/bin/env node
/**
 * Apply 005_want_to_read_and_not_interested.sql to live Supabase.
 *
 * Prefers DATABASE_URL / SUPABASE_DB_URL (postgres connection string).
 * Service role REST cannot run DDL — this needs direct Postgres.
 *
 * Usage:
 *   DATABASE_URL='postgresql://postgres.[ref]:[password]@aws-0-....pooler.supabase.com:6543/postgres' \
 *     node scripts/apply-migration-005.mjs
 *
 * Or paste the SQL file into Supabase SQL editor (project nhkgwehogbywycxwzgyl).
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(__dirname, '..', 'supabase', 'migrations', '005_want_to_read_and_not_interested.sql')
const sql = readFileSync(sqlPath, 'utf8')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_CONNECTION_STRING

async function verifyViaRest() {
  if (!url || !serviceKey) {
    console.log('No REST credentials to verify columns.')
    return false
  }
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { error } = await sb.from('user_books').select('want_to_read, not_interested').limit(1)
  if (error) {
    console.error('VERIFY FAIL:', error.message)
    return false
  }
  console.log('VERIFY OK: want_to_read + not_interested columns present')
  const { data } = await sb.from('user_books').select('status')
  const dist = {}
  for (const r of data || []) dist[r.status] = (dist[r.status] || 0) + 1
  console.log('status distribution (unchanged by this migration):', dist)
  return true
}

async function applyViaPg() {
  if (!dbUrl) return false
  let Client
  try {
    ;({ Client } = require('pg'))
  } catch {
    console.error('pg package not installed. npm i pg  OR paste SQL in dashboard.')
    return false
  }
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Migration 005 applied via Postgres.')
    return true
  } finally {
    await client.end()
  }
}

const okPg = await applyViaPg()
if (!okPg) {
  console.log(`
No DATABASE_URL — cannot run DDL via service-role REST.

Paste this file into Supabase SQL editor:
  ${sqlPath}

Project: nhkgwehogbywycxwzgyl
Then re-run: node scripts/apply-migration-005.mjs  (verify-only path)
`)
}

const ok = await verifyViaRest()
process.exit(ok ? 0 : 1)
