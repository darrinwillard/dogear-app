import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  AUDIBLE_LIBRARY_RESPONSE_GROUPS,
  readCoverUrl,
  readIsFinished,
  readPercent,
  readSeriesFields,
  type AudibleItem,
} from "@/lib/books/audible-parse";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PAGE_SIZE = 1000;
const BOOK_UPSERT_CHUNK = 50;
const USER_BOOK_CHUNK = 100;

/**
 * HARD RULE: this route must NEVER overwrite user_books.status, rating,
 * finished_at, started_at, notes, almost_finished_dismissed_at, status_source,
 * want_to_read, or not_interested.
 * Progress fields are advisory only. Status / want flags change only via user APIs / seed.
 */
export async function POST(_req: NextRequest) {
  const startedAt = new Date().toISOString();
  let syncLogId: string | null = null;

  try {
    const supabaseServer = await createServerClient();
    const {
      data: { user },
    } = await supabaseServer.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Best-effort sync_logs row
    try {
      const { data: logRow } = await supabase
        .from("sync_logs")
        .insert({
          user_id: user.id,
          status: "running",
          books_synced: 0,
          started_at: startedAt,
        })
        .select("id")
        .single();
      syncLogId = logRow?.id ?? null;
    } catch {
      // non-fatal
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("audible_refresh_token, audible_locale")
      .eq("id", user.id)
      .single();

    if (!profile?.audible_refresh_token) {
      return NextResponse.json(
        { error: "No Audible account connected" },
        { status: 400 }
      );
    }

    const tokens = JSON.parse(profile.audible_refresh_token);

    const refreshResponse = await fetch("https://api.amazon.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        app_name: "Audible",
        app_version: "3.56.2",
        source_token: tokens.refresh_token,
        requested_token_type: "access_token",
        source_token_type: "refresh_token",
      }).toString(),
    });

    const refreshData = await refreshResponse.json();
    const accessToken = refreshData.access_token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token refresh failed — please reconnect Audible" },
        { status: 401 }
      );
    }

    // Paginate library — Audible caps at 1000/page.
    // IMPORTANT: Audible's library API is 1-indexed. page=0 returns HTTP 400
    // ("Member must have value greater than or equal to 1"), so we start at 1.
    // `media` in AUDIBLE_LIBRARY_RESPONSE_GROUPS is required for product_images.
    const items: AudibleItem[] = [];
    let page = 1;
    let hitPageCap = false;
    while (true) {
      const params = new URLSearchParams({
        response_groups: AUDIBLE_LIBRARY_RESPONSE_GROUPS,
        num_results: String(PAGE_SIZE),
        page: String(page),
      });
      const libraryResponse = await fetch(
        `https://api.audible.com/1.0/library?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!libraryResponse.ok) {
        const text = await libraryResponse.text();
        throw new Error(`Audible library fetch failed: ${libraryResponse.status} ${text.slice(0, 200)}`);
      }
      const libraryData = await libraryResponse.json();
      const pageItems: AudibleItem[] = libraryData.items || [];
      items.push(...pageItems);
      if (pageItems.length < PAGE_SIZE) break;
      // Full page — may be more; keep going, but flag if we stop after one full page without next
      hitPageCap = true;
      page += 1;
      // Safety: don't infinite-loop (page is 1-indexed)
      if (page > 20) break;
    }

    const truncatedWarning =
      hitPageCap && items.length % PAGE_SIZE === 0
        ? `Library page returned exactly ${PAGE_SIZE} items on last page — possible truncation if Audible has more.`
        : null;

    // Log one sample shape for progress + cover fields (redacted) once
    const sample =
      items.find(
        (i) =>
          i.percent_complete != null ||
          i.is_finished != null ||
          i.listening_status != null ||
          (Array.isArray(i.series) && i.series.length > 0) ||
          i.product_images != null
      ) ?? items[0];
    if (sample) {
      const coverSample = readCoverUrl(sample);
      console.log(
        "[audible-sync] sample fields",
        JSON.stringify({
          asin: sample.asin,
          has_series: Array.isArray(sample.series),
          series0: sample.series?.[0] ?? null,
          percent_complete: sample.percent_complete ?? null,
          is_finished: sample.is_finished ?? null,
          listening_status_keys: sample.listening_status
            ? Object.keys(sample.listening_status)
            : null,
          product_images_keys: sample.product_images
            ? Object.keys(sample.product_images)
            : null,
          cover_url_parsed: coverSample ?? null,
          items_total: items.length,
        })
      );
    }

    // Preload existing user_books once (avoid N+1)
    const { data: existingRows } = await supabase
      .from("user_books")
      .select("id, asin, purchase_date")
      .eq("user_id", user.id);

    const existingByAsin = new Map(
      (existingRows || []).map((r) => [r.asin as string, r])
    );

    // Preload existing books series so we can presence-guard without null clobber
    const asins = items.map((i) => i.asin).filter((a): a is string => Boolean(a));
    const existingBooksByAsin = new Map<
      string,
      { id: string; series_name: string | null; series_position: number | null; cover_url: string | null }
    >();

    for (let i = 0; i < asins.length; i += 200) {
      const chunk = asins.slice(i, i + 200);
      const { data: bookRows } = await supabase
        .from("books")
        .select("id, asin, series_name, series_position, cover_url")
        .in("asin", chunk);
      for (const row of bookRows || []) {
        existingBooksByAsin.set(row.asin, row);
      }
    }

    type BookUpsert = {
      asin: string;
      title: string;
      authors: string[];
      narrator: string | null;
      runtime_minutes: number | null;
      cover_url?: string | null;
      series_name?: string | null;
      series_position?: number | null;
      publisher?: string | null;
      release_date?: string | null;
      updated_at: string;
    };

    const now = new Date().toISOString();
    const bookUpserts: BookUpsert[] = [];
    const progressByAsin = new Map<
      string,
      {
        percent_complete?: number | null;
        is_finished?: boolean;
        purchase_date: string | null;
      }
    >();

    let seriesWritten = 0;
    let seriesSkippedAbsent = 0;
    let seriesRangeSkipped = 0;
    let progressWritten = 0;

    for (const item of items) {
      const asin = item.asin;
      if (!asin) continue;

      const narrators = (item.narrators || [])
        .map((n) => n.name)
        .filter(Boolean);
      const authors = (item.authors || []).map((a) => a.name).filter(Boolean);
      const series = readSeriesFields(item);
      const cover = readCoverUrl(item);
      const percent = readPercent(item);
      const finished = readIsFinished(item);
      const existingBook = existingBooksByAsin.get(asin); // reserved for future merge diagnostics
      void existingBook;

      const row: BookUpsert = {
        asin,
        title: item.title || "Unknown",
        authors,
        narrator: narrators.join(", ") || null,
        runtime_minutes: item.runtime_length_min || null,
        updated_at: now,
      };

      // Presence-guard series: only write when Audible included series data with a title.
      // Never null-clobber previously seeded/backfilled series_name/position.
      if (series.seriesPresent && series.seriesName) {
        row.series_name = series.seriesName;
        if (series.seriesIsRange) {
          // Range/omnibus like "1-3": write series NAME only. Never write a
          // corrupted numeric position (old bug: parseFloat("1-3") === 1).
          // Leave any existing series_position untouched.
          seriesRangeSkipped++;
          console.log(
            "[audible-sync] range sequence skipped for position",
            asin,
            series.seriesPositionRaw
          );
        } else if (series.seriesPosition != null) {
          row.series_position = series.seriesPosition;
        }
        seriesWritten++;
      } else {
        seriesSkippedAbsent++;
        // omit series_name / series_position keys entirely so upsert doesn't null them
      }

      // Presence-guard cover: only overwrite when Audible provided an image
      if (cover !== undefined && cover) {
        row.cover_url = cover;
      }

      if (item.publisher_name) {
        row.publisher = item.publisher_name;
      }
      const release =
        item.release_date ||
        (item.publication_datetime
          ? item.publication_datetime.slice(0, 10)
          : null);
      if (release) {
        row.release_date = release;
      }

      bookUpserts.push(row);

      const progress: {
        percent_complete?: number | null;
        is_finished?: boolean;
        purchase_date: string | null;
      } = {
        purchase_date: item.purchase_date
          ? new Date(item.purchase_date).toISOString().split("T")[0]
          : null,
      };
      // Presence-guard progress fields — never write null/false over prior values when absent
      if (percent !== undefined) {
        progress.percent_complete = percent;
        progressWritten++;
      }
      if (finished !== undefined) {
        progress.is_finished = finished;
      }
      progressByAsin.set(asin, progress);
    }

    // Batch upsert books
    let booksUpserted = 0;
    for (let i = 0; i < bookUpserts.length; i += BOOK_UPSERT_CHUNK) {
      const chunk = bookUpserts.slice(i, i + BOOK_UPSERT_CHUNK);
      const { data, error } = await supabase
        .from("books")
        .upsert(chunk, { onConflict: "asin" })
        .select("id, asin");
      if (error) {
        console.error("[audible-sync] books upsert error", error);
        throw error;
      }
      for (const b of data || []) {
        existingBooksByAsin.set(b.asin, {
          id: b.id,
          series_name: existingBooksByAsin.get(b.asin)?.series_name ?? null,
          series_position:
            existingBooksByAsin.get(b.asin)?.series_position ?? null,
          cover_url: existingBooksByAsin.get(b.asin)?.cover_url ?? null,
        });
      }
      booksUpserted += data?.length || 0;
    }

    // Ensure we have book ids for all asins (re-fetch any missing)
    const missingAsins = asins.filter((a) => !existingBooksByAsin.get(a)?.id);
    for (let i = 0; i < missingAsins.length; i += 200) {
      const chunk = missingAsins.slice(i, i + 200);
      const { data: bookRows } = await supabase
        .from("books")
        .select("id, asin, series_name, series_position, cover_url")
        .in("asin", chunk);
      for (const row of bookRows || []) {
        existingBooksByAsin.set(row.asin, row);
      }
    }

    // Build user_books inserts + updates
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];

    for (const asin of asins) {
      const book = existingBooksByAsin.get(asin);
      if (!book?.id) continue;
      const progress = progressByAsin.get(asin);
      if (!progress) continue;

      const existing = existingByAsin.get(asin);
      const progressPatch: Record<string, unknown> = {
        book_id: book.id,
        progress_synced_at: now,
        updated_at: now,
      };
      if (progress.percent_complete !== undefined) {
        progressPatch.percent_complete = progress.percent_complete;
      }
      if (progress.is_finished !== undefined) {
        progressPatch.is_finished = progress.is_finished;
      }
      if (progress.purchase_date) {
        // Fill purchase_date if missing; update if Audible has value
        if (!existing || !existing.purchase_date) {
          progressPatch.purchase_date = progress.purchase_date;
        } else {
          progressPatch.purchase_date = progress.purchase_date;
        }
      }

      if (!existing) {
        // New Audible titles default to owned-unread (status=unstarted).
        // want_to_read stays false — wishlist is explicit only.
        toInsert.push({
          user_id: user.id,
          book_id: book.id,
          asin,
          status: "unstarted",
          purchase_date: progress.purchase_date,
          want_to_read: false,
          not_interested: false,
          ...(progress.percent_complete !== undefined
            ? { percent_complete: progress.percent_complete }
            : {}),
          ...(progress.is_finished !== undefined
            ? { is_finished: progress.is_finished }
            : {}),
          progress_synced_at: now,
        });
      } else {
        toUpdate.push({ id: existing.id, patch: progressPatch });
      }
    }

    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += USER_BOOK_CHUNK) {
      const chunk = toInsert.slice(i, i + USER_BOOK_CHUNK);
      const { error, data } = await supabase
        .from("user_books")
        .upsert(chunk, { onConflict: "user_id,asin", ignoreDuplicates: false })
        .select("id");
      if (error) {
        // If optional columns missing (migration not applied), retry stripped insert
        const msg = error.message || "";
        if (
          msg.includes("percent_complete") ||
          msg.includes("is_finished") ||
          msg.includes("progress_synced_at") ||
          msg.includes("want_to_read") ||
          msg.includes("not_interested")
        ) {
          const stripped = chunk.map((r) => {
            const row: Record<string, unknown> = {
              user_id: r.user_id,
              book_id: r.book_id,
              asin: r.asin,
              status: "unstarted",
              purchase_date: r.purchase_date ?? null,
            };
            // Keep progress if those columns exist; drop want flags on retry
            if (
              !msg.includes("percent_complete") &&
              r.percent_complete !== undefined
            ) {
              row.percent_complete = r.percent_complete;
            }
            if (!msg.includes("is_finished") && r.is_finished !== undefined) {
              row.is_finished = r.is_finished;
            }
            if (
              !msg.includes("progress_synced_at") &&
              r.progress_synced_at !== undefined
            ) {
              row.progress_synced_at = r.progress_synced_at;
            }
            return row;
          });
          const retry = await supabase
            .from("user_books")
            .upsert(stripped, {
              onConflict: "user_id,asin",
              ignoreDuplicates: true,
            })
            .select("id");
          if (retry.error) {
            // Last resort: bare minimum columns from schema 001
            const minimal = chunk.map((r) => ({
              user_id: r.user_id,
              book_id: r.book_id,
              asin: r.asin,
              status: "unstarted",
              purchase_date: r.purchase_date ?? null,
            }));
            const retry2 = await supabase
              .from("user_books")
              .upsert(minimal, {
                onConflict: "user_id,asin",
                ignoreDuplicates: true,
              })
              .select("id");
            if (retry2.error) throw retry2.error;
            inserted += retry2.data?.length || 0;
          } else {
            inserted += retry.data?.length || 0;
          }
        } else {
          throw error;
        }
      } else {
        inserted += data?.length || 0;
      }
    }

    let updated = 0;
    // Batch updates by running sequential chunks (PostgREST has no multi-row heterogeneous update)
    // Optimize: group identical patches is hard; do per-id updates in parallel batches
    for (let i = 0; i < toUpdate.length; i += 25) {
      const chunk = toUpdate.slice(i, i + 25);
      const results = await Promise.all(
        chunk.map(({ id, patch }) =>
          supabase.from("user_books").update(patch).eq("id", id)
        )
      );
      for (const r of results) {
        if (r.error) {
          // Soft-fail missing columns by stripping progress fields once
          if (
            r.error.message?.includes("percent_complete") ||
            r.error.message?.includes("is_finished") ||
            r.error.message?.includes("progress_synced_at")
          ) {
            // Migration not applied — skip progress updates silently
            continue;
          }
          console.error("[audible-sync] user_books update error", r.error);
        } else {
          updated++;
        }
      }
    }

    const synced = inserted + updated + (asins.length - toInsert.length - toUpdate.length > 0
      ? 0
      : 0);
    const booksSynced = asins.length;

    await supabase
      .from("user_profiles")
      .update({ last_synced_at: now })
      .eq("id", user.id);

    if (syncLogId) {
      await supabase
        .from("sync_logs")
        .update({
          status: "success",
          books_synced: booksSynced,
          finished_at: new Date().toISOString(),
          error_message: truncatedWarning,
        })
        .eq("id", syncLogId);
    }

    return NextResponse.json({
      success: true,
      books_synced: booksSynced,
      books_upserted: booksUpserted,
      user_books_inserted: inserted,
      user_books_updated: updated,
      series_fields_written: seriesWritten,
      series_absent_skipped: seriesSkippedAbsent,
      series_range_position_skipped: seriesRangeSkipped,
      progress_fields_written: progressWritten,
      truncated_warning: truncatedWarning,
      sample_asin: sample?.asin ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[audible-sync]", message);
    try {
      if (syncLogId) {
        const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        await supabase
          .from("sync_logs")
          .update({
            status: "error",
            error_message: message,
            finished_at: new Date().toISOString(),
          })
          .eq("id", syncLogId);
      }
    } catch {
      // ignore
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
