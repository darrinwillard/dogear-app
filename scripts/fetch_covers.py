#!/usr/bin/env python3
"""
fetch_covers.py — Fetch book cover URLs from Open Library and update reading-tracker.json.

Usage:
    python scripts/fetch_covers.py

Reads src/data/reading-tracker.json, queries Open Library for each book missing
a cover_url, then writes the updated JSON back. Rate-limited to 1 req/sec.
"""

import json
import time
import urllib.request
import urllib.parse
import urllib.error
import sys
from pathlib import Path

DATA_PATH = Path(__file__).parent.parent / "src" / "data" / "reading-tracker.json"
SEARCH_URL = "https://openlibrary.org/search.json"
COVER_BASE = "https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
RATE_LIMIT = 1.0  # seconds between requests


def fetch_cover(title: str, author: str) -> str | None:
    params = urllib.parse.urlencode({
        "title": title,
        "author": author,
        "limit": 1,
        "fields": "cover_i,title,author_name",
    })
    url = f"{SEARCH_URL}?{params}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "DogEar-BookTracker/1.0 (personal reading tracker)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        docs = data.get("docs", [])
        if docs and docs[0].get("cover_i"):
            cover_id = docs[0]["cover_i"]
            return COVER_BASE.format(cover_id=cover_id)
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as e:
        print(f"  [warn] {title}: {e}", file=sys.stderr)
    return None


def main():
    with open(DATA_PATH) as f:
        tracker = json.load(f)

    books = tracker["books"]
    missing = [b for b in books if not b.get("cover_url")]
    print(f"Books missing cover: {len(missing)} / {len(books)}")

    updated = 0
    not_found = 0

    for i, book in enumerate(books):
        if book.get("cover_url"):
            continue

        title = book["title"]
        author = book["authors"][0] if book["authors"] else ""
        print(f"[{i+1}/{len(books)}] {title} — {author}", end=" ... ", flush=True)

        cover_url = fetch_cover(title, author)
        if cover_url:
            book["cover_url"] = cover_url
            print(f"✓")
            updated += 1
        else:
            book["cover_url"] = None
            print("not found")
            not_found += 1

        time.sleep(RATE_LIMIT)

    with open(DATA_PATH, "w") as f:
        json.dump(tracker, f, indent=2, ensure_ascii=False)

    print(f"\nDone. Updated: {updated}, Not found: {not_found}")
    print(f"Wrote {DATA_PATH}")


if __name__ == "__main__":
    main()
