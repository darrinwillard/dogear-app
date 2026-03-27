"""
POST /api/sync
Body: { user_id }

Fetches the user's Audible library using the stored refresh token, upserts
books into the `books` table, and creates user_book records.
"""

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import audible
from supabase import create_client


SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
                library = client.get(
                    "library",
                    num_results=1000,
                    response_groups=(
                        "product_details,product_attrs,relationships,"
                        "series,rating,contributors,product_images"
                    ),
                )

            items = library.get("items", [])
            books_synced = 0

            for item in items:
                asin = item.get("asin")
                if not asin:
                    continue

                authors = [
                    a["name"]
                    for a in item.get("authors", [])
                    if isinstance(a, dict)
                ]
                narrators = [
                    n["name"]
                    for n in item.get("narrators", [])
                    if isinstance(n, dict)
                ]
                series_list = item.get("series", []) or []
                series_name = series_list[0].get("title") if series_list else None
                series_pos_raw = series_list[0].get("sequence") if series_list else None
                try:
                    series_position = float(series_pos_raw) if series_pos_raw else None
                except (TypeError, ValueError):
                    series_position = None

                cover_url = None
                images = item.get("product_images", {})
                if images:
                    cover_url = images.get("500") or images.get("1215") or next(
                        iter(images.values()), None
                    )

                runtime_minutes = item.get("runtime_length_min")

                book_row = {
                    "asin": asin,
                    "title": item.get("title", "Unknown"),
                    "authors": authors,
                    "narrator": narrators[0] if narrators else None,
                    "runtime_minutes": runtime_minutes,
                    "cover_url": cover_url,
                    "series_name": series_name,
                    "series_position": series_position,
                    "publisher": item.get("publisher_name"),
                    "summary": item.get("merchandising_summary"),
                    "updated_at": _now(),
                }

                # Upsert book metadata
                book_result = (
                    sb.table("books")
                    .upsert(book_row, on_conflict="asin")
                    .execute()
                )
                book_id = book_result.data[0]["id"]

                # Upsert user's ownership record
                purchase_date = item.get("purchase_date", "")[:10] or None
                sb.table("user_books").upsert(
                    {
                        "user_id": user_id,
                        "book_id": book_id,
                        "asin": asin,
                        "purchase_date": purchase_date,
                        "updated_at": _now(),
                    },
                    on_conflict="user_id,asin",
                ).execute()

                books_synced += 1

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

            self._respond(200, {"ok": True, "books_synced": books_synced})

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
