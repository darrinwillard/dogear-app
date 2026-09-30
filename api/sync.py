"""
POST /api/sync
Body: { user_id }

Fetches the user's Audible library using the stored refresh token, upserts
books into the `books` table, and creates user_book records.

Uses full library pagination (page/num_results) and batched Supabase upserts
so large libraries stay under Vercel function timeouts.
"""

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import audible
from supabase import create_client


SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Audible library page size (API accepts up to 1000). Paginate past a single page
# so libraries larger than 1000 are not silently truncated.
PAGE_SIZE = 1000
MAX_LIBRARY_PAGES = 100
BOOK_UPSERT_CHUNK = 200
USER_BOOK_CHUNK = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _fetch_all_library_items(client) -> list[dict]:
    """Paginate Audible /library. Page is 1-indexed; page=0 returns HTTP 400."""
    all_items: list[dict] = []
    seen: set[str] = set()
    page = 1
    while page <= MAX_LIBRARY_PAGES:
        response = client.get(
            "library",
            num_results=PAGE_SIZE,
            page=page,
            response_groups=(
                "product_details,product_attrs,relationships,"
                "series,rating,contributors,product_images"
            ),
        )
        items = response.get("items", []) or []
        for item in items:
            asin = item.get("asin")
            if asin and asin in seen:
                continue
            if asin:
                seen.add(asin)
            all_items.append(item)
        if len(items) < PAGE_SIZE:
            break
        page += 1
    return all_items


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        user_id = body.get("user_id", "").strip()

        if not user_id:
            self._respond(400, {"error": "user_id is required"})
            return

        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

        # Look up stored refresh token
        profile = (
            sb.table("user_profiles")
            .select("audible_refresh_token, audible_locale")
            .eq("id", user_id)
            .single()
            .execute()
        )
        if not profile.data or not profile.data.get("audible_refresh_token"):
            self._respond(400, {"error": "No Audible token on file. Connect Audible first."})
            return

        refresh_token = profile.data["audible_refresh_token"]
        locale = profile.data.get("audible_locale", "us")

        # Create sync log
        log = (
            sb.table("sync_logs")
            .insert({"user_id": user_id, "status": "running"})
            .execute()
        )
        log_id = log.data[0]["id"]

        try:
            auth = audible.Authenticator.from_refresh_token(
                refresh_token=refresh_token,
                locale=locale,
            )

            with audible.Client(auth=auth) as client:
                items = _fetch_all_library_items(client)

            book_rows = []
            user_book_rows = []
            now = _now()

            for item in items:
                asin = item.get("asin")
                if not asin:
                    continue

                authors = [
                    a["name"]
                    for a in item.get("authors", [])
                    if isinstance(a, dict) and a.get("name")
                ]
                narrators = [
                    n["name"]
                    for n in item.get("narrators", [])
                    if isinstance(n, dict) and n.get("name")
                ]
                series_list = item.get("series", []) or []
                series_name = series_list[0].get("title") if series_list else None
                series_pos_raw = series_list[0].get("sequence") if series_list else None
                try:
                    series_position = float(series_pos_raw) if series_pos_raw else None
                except (TypeError, ValueError):
                    series_position = None

                cover_url = None
                images = item.get("product_images", {}) or {}
                if images:
                    cover_url = images.get("500") or images.get("1215") or next(
                        iter(images.values()), None
                    )

                book_rows.append(
                    {
                        "asin": asin,
                        "title": item.get("title", "Unknown"),
                        "authors": authors,
                        "narrator": narrators[0] if narrators else None,
                        "runtime_minutes": item.get("runtime_length_min"),
                        "cover_url": cover_url,
                        "series_name": series_name,
                        "series_position": series_position,
                        "publisher": item.get("publisher_name"),
                        "summary": item.get("merchandising_summary"),
                        "updated_at": now,
                    }
                )

                purchase_date = (item.get("purchase_date") or "")[:10] or None
                user_book_rows.append(
                    {
                        "user_id": user_id,
                        "asin": asin,
                        "purchase_date": purchase_date,
                        "updated_at": now,
                    }
                )

            # Batch upsert books, collect asin -> id
            asin_to_id: dict[str, str] = {}
            for chunk in _chunks(book_rows, BOOK_UPSERT_CHUNK):
                result = (
                    sb.table("books")
                    .upsert(chunk, on_conflict="asin")
                    .execute()
                )
                for row in result.data or []:
                    asin_to_id[row["asin"]] = row["id"]

            # Ensure ids for any missing (shouldn't happen, but safe)
            missing = [r["asin"] for r in book_rows if r["asin"] not in asin_to_id]
            for chunk in _chunks(missing, 200):
                if not chunk:
                    continue
                fetched = (
                    sb.table("books")
                    .select("id, asin")
                    .in_("asin", chunk)
                    .execute()
                )
                for row in fetched.data or []:
                    asin_to_id[row["asin"]] = row["id"]

            # Attach book_id and batch upsert user_books
            payload = []
            for row in user_book_rows:
                book_id = asin_to_id.get(row["asin"])
                if not book_id:
                    continue
                payload.append({**row, "book_id": book_id})

            books_synced = 0
            for chunk in _chunks(payload, USER_BOOK_CHUNK):
                sb.table("user_books").upsert(
                    chunk,
                    on_conflict="user_id,asin",
                ).execute()
                books_synced += len(chunk)

            # Mark sync complete
            sb.table("sync_logs").update(
                {
                    "status": "success",
                    "books_synced": books_synced,
                    "finished_at": _now(),
                }
            ).eq("id", log_id).execute()

            sb.table("user_profiles").update({"last_synced_at": _now()}).eq(
                "id", user_id
            ).execute()

            self._respond(
                200,
                {
                    "ok": True,
                    "books_synced": books_synced,
                    "library_items": len(items),
                },
            )

        except Exception as exc:
            sb.table("sync_logs").update(
                {
                    "status": "error",
                    "error_message": str(exc),
                    "finished_at": _now(),
                }
            ).eq("id", log_id).execute()
            self._respond(500, {"error": str(exc)})

    def _respond(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
