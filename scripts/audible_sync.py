#!/usr/bin/env python3
"""
audible_sync.py — Sync Audible library metadata into reading-tracker.json.

Usage:
    pip install audible
    python scripts/audible_sync.py

Reads credentials from /Users/darrin/.openclaw/integrations/audible_auth.json,
fetches the full Audible library, matches books by title/ASIN, and updates
narrator, runtime_length_min, asin fields. Also adds new Audible books not
yet in the tracker.
"""

import json
import re
import sys
from pathlib import Path

DATA_PATH = Path(__file__).parent.parent / "src" / "data" / "reading-tracker.json"
CREDS_PATH = Path("/Users/darrin/.openclaw/integrations/audible_auth.json")


def normalize_title(title: str) -> str:
    """Lowercase, strip punctuation and common subtitle separators for fuzzy matching."""
    title = title.lower()
    # Strip subtitles after colon/dash
    title = re.split(r"[:\-–—]", title)[0]
    title = re.sub(r"[^\w\s]", "", title)
    return title.strip()


def load_credentials() -> dict:
    if not CREDS_PATH.exists():
        print(f"ERROR: Credentials not found at {CREDS_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(CREDS_PATH) as f:
        return json.load(f)


def build_auth(creds: dict):
    """Build an audible.Authenticator from stored credentials."""
    try:
        import audible
    except ImportError:
        print("ERROR: audible library not installed. Run: pip install audible", file=sys.stderr)
        sys.exit(1)

    auth = audible.Authenticator.from_file(str(CREDS_PATH))
    return auth


def fetch_library(auth) -> list[dict]:
    """Fetch all library items from Audible API."""
    import audible

    all_items = []
    page = 1
    page_size = 50

    with audible.Client(auth=auth) as client:
        while True:
            print(f"  Fetching page {page} ({page_size} items)...", flush=True)
            response = client.get(
                "1.0/library",
                num_results=page_size,
                page=page,
                response_groups="product_desc,product_attrs,relationships,contributors",
                sort_by="-PurchaseDate",
            )
            items = response.get("items", [])
            if not items:
                break
            all_items.extend(items)
            if len(items) < page_size:
                break
            page += 1

    return all_items


def parse_item(item: dict) -> dict:
    """Extract relevant fields from an Audible library item."""
    authors = []
    for contrib in (item.get("authors") or []):
        name = contrib.get("name", "")
        if name:
            authors.append(name)

    narrators = []
    for contrib in (item.get("narrators") or []):
        name = contrib.get("name", "")
        if name:
            narrators.append(name)

    return {
        "title": item.get("title", ""),
        "asin": item.get("asin", ""),
        "authors": authors,
        "narrator": ", ".join(narrators) if narrators else None,
        "runtime_length_min": item.get("runtime_length_min"),
        "purchase_date": item.get("purchase_date", ""),
    }


def match_book(audible_item: dict, tracker_books: list[dict]) -> dict | None:
    """Find a matching book in tracker by ASIN or normalized title."""
    asin = audible_item.get("asin", "")
    norm_title = normalize_title(audible_item["title"])

    for book in tracker_books:
        # ASIN match
        if asin and book.get("asin") == asin:
            return book
        # Normalized title match
        if normalize_title(book["title"]) == norm_title:
            return book

    return None


def main():
    print("Loading credentials...")
    creds = load_credentials()
    auth = build_auth(creds)

    print("Fetching Audible library...")
    raw_items = fetch_library(auth)
    print(f"Fetched {len(raw_items)} items from Audible")

    with open(DATA_PATH) as f:
        tracker = json.load(f)

    books = tracker["books"]

    updated = 0
    added = 0
    skipped = 0

    for raw in raw_items:
        item = parse_item(raw)
        if not item["title"]:
            continue

        match = match_book(item, books)

        if match:
            changed = False
            if item["asin"] and not match.get("asin"):
                match["asin"] = item["asin"]
                changed = True
            if item["narrator"] and not match.get("narrator"):
                match["narrator"] = item["narrator"]
                changed = True
            if item["runtime_length_min"] and not match.get("runtime_length_min"):
                match["runtime_length_min"] = item["runtime_length_min"]
                changed = True
            if changed:
                print(f"  Updated: {match['title']}")
                updated += 1
            else:
                skipped += 1
        else:
            # Add new book to tracker
            new_book = {
                "title": item["title"],
                "authors": item["authors"],
                "series": None,
                "series_num": None,
                "audible_purchased": item["purchase_date"][:10] if item["purchase_date"] else None,
                "gr_shelf": None,
                "gr_date_read": None,
                "gr_rating": None,
                "status": "to_read",
                "sources": ["audible"],
                "asin": item["asin"] or None,
                "narrator": item["narrator"],
                "runtime_length_min": item["runtime_length_min"],
                "cover_url": None,
            }
            books.append(new_book)
            print(f"  Added: {item['title']}")
            added += 1

    # Update stats
    tracker["stats"]["total_unique"] = len(books)

    with open(DATA_PATH, "w") as f:
        json.dump(tracker, f, indent=2, ensure_ascii=False)

    print(f"\nSummary:")
    print(f"  Updated existing books: {updated}")
    print(f"  Added new books:        {added}")
    print(f"  Already up to date:     {skipped}")
    print(f"  Total in tracker:       {len(books)}")
    print(f"Wrote {DATA_PATH}")


if __name__ == "__main__":
    main()
