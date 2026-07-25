#!/usr/bin/env python3
"""
KARLCON Elite Retreats — manifest builder
─────────────────────────────────────────────────────────────────
Scans a root folder shaped like your scraper's output:

    airbnb_data/
      Share_Save_4040223/
        info.json
        images/
          image_001.jpeg
          image_002.jpeg
          ...
      Share_Save_5636077/
        info.json
        images/
          ...

...and produces everything the site needs to run:

    data/listings.js                    window.LISTINGS = [...]
    data/listings/<id>/images/*.jpg      optimised local copies

Usage (from this folder):
    python build_manifest.py "C:\\Users\\taten\\OneDrive\\Desktop\\Space\\airbnb_data"

Re-run any time you add/refresh Share_Save_* folders — it does a
full rebuild each time, so it's always safe to re-run.
─────────────────────────────────────────────────────────────────
"""
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Missing dependency. Run:  pip install pillow")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_WIDTH = 1920
JPEG_QUALITY = 84


def natural_key(p: Path):
    """Sort image_2 before image_10, etc."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.stem)]


def find_coords(info: dict):
    """Best-effort search for latitude/longitude across a few common
    scraper field shapes. Returns (lat, lng) or (None, None)."""
    candidates = [
        info.get("coordinates"),
        info.get("geo"),
        info.get("location") if isinstance(info.get("location"), dict) else None,
        info,
    ]
    for c in candidates:
        if not isinstance(c, dict):
            continue
        lat = c.get("lat") or c.get("latitude")
        lng = c.get("lng") or c.get("lon") or c.get("longitude")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            return float(lat), float(lng)
    return None, None


def clean_text(v):
    """Scrapers often leave stray UI text ('Share\\nSave') in fields that
    should be empty. Treat obvious junk / blank strings as missing."""
    if not isinstance(v, str):
        return v
    v = v.strip()
    if not v or v.lower() in {"share\nsave", "share", "save"}:
        return None
    return v


def process_images(images_dir: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    if not images_dir.is_dir():
        return written
    files = sorted(
        [p for p in images_dir.iterdir() if p.suffix.lower() in IMAGE_EXT],
        key=natural_key,
    )
    for i, src in enumerate(files, start=1):
        dst_name = f"image_{i:03d}.jpg"
        dst = out_dir / dst_name
        try:
            im = Image.open(src).convert("RGB")
            if im.width > MAX_WIDTH:
                h = int(im.height * (MAX_WIDTH / im.width))
                im = im.resize((MAX_WIDTH, h), Image.LANCZOS)
            im.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)
            written.append(dst_name)
        except Exception as e:
            print(f"  ! skipped {src.name}: {e}")
    return written


def load_coordinates_fallback(root: Path):
    """The location-backfill script (backfill_coordinates.py) writes a flat
    {listingId: {lat, lng, location}} map to <root>/coordinates.json. If a
    listing's own info.json still lacks lat/lng (e.g. because the folder path
    the backfill used didn't line up with where the Share_* folders actually
    live), fall back to this file instead of leaving the listing unmapped."""
    coords_path = root / "coordinates.json"
    if not coords_path.exists():
        return {}
    try:
        return json.loads(coords_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"! could not parse {coords_path}: {e}")
        return {}


def build(root: Path, site_dir: Path):
    listings = []
    coords_fallback = load_coordinates_fallback(root)
    # Broadened from the original "Share_Save_*" to any "Share_*" prefix so
    # folders exported/renamed slightly differently (e.g. "Share_5636077")
    # still get picked up. Non-folders and folders without info.json are
    # silently skipped below, so this is safe to broaden.
    folders = sorted(p for p in root.glob("Share_*") if p.is_dir())
    if not folders:
        print(f"No Share_* folders found under {root}")
        return

    for folder in folders:
        info_path = folder / "info.json"
        if not info_path.exists():
            continue
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"! could not parse {info_path}: {e}")
            continue

        listing_id = str(info.get("listingId") or folder.name.replace("Share_Save_", ""))
        raw_title = clean_text(info.get("title")) or "Untitled retreat"
        title, tagline = raw_title, clean_text(info.get("subtitle"))
        # scraped titles are often "Name - Feature - Feature" — split that
        # into a clean title + tagline rather than showing the raw string.
        if not tagline and " - " in raw_title:
            parts = [p.strip(" -") for p in re.split(r"\s*-\s*", raw_title) if p.strip(" -")]
            if len(parts) > 1:
                title, tagline = parts[0], " · ".join(parts[1:])
        host = info.get("host") or {}
        lat, lng = find_coords(info)
        if lat is None or lng is None:
            fallback = coords_fallback.get(listing_id)
            if fallback:
                lat = fallback.get("lat")
                lng = fallback.get("lng")

        img_out_dir = site_dir / "data" / "listings" / listing_id / "images"
        image_files = process_images(folder / "images", img_out_dir)
        image_paths = [f"data/listings/{listing_id}/images/{name}" for name in image_files]

        listings.append({
            "id": listing_id,
            "title": title,
            "tagline": tagline,
            "url": info.get("url") or f"https://www.airbnb.com/rooms/{listing_id}",
            "host": {
                "name": clean_text(host.get("name")) or "Host",
                "superhost": bool(host.get("superhost")),
                "yearsHosting": clean_text(host.get("yearsHosting")),
            },
            "price": clean_text(info.get("price")),
            "rating": clean_text(info.get("rating")),
            "reviewsCount": clean_text(info.get("reviewsCount")),
            "description": clean_text(info.get("description")),
            "amenities": info.get("amenities") or [],
            "images": image_paths,
            "lat": lat,
            "lng": lng,
            "areaLabel": clean_text(info.get("location")) or "Zimbabwe",
        })
        print(f"✓ {title}  ({len(image_paths)} photos)")

    out_js = site_dir / "data" / "listings.js"
    payload = "window.LISTINGS = " + json.dumps(listings, indent=2, ensure_ascii=False) + ";\n"
    out_js.write_text(payload, encoding="utf-8")
    print(f"\nWrote {out_js}  —  {len(listings)} retreat(s) indexed.")


def find_data_root(site_dir: Path):
    """When no path is passed (e.g. running inside a cloned GitHub repo where
    the scraped data was committed alongside the site), look for a folder
    that directly contains Share_* subfolders in a few likely spots instead
    of forcing a manual absolute path."""
    candidates = [
        site_dir / "airbnb_data",
        site_dir.parent / "airbnb_data",
        site_dir / "data",   # Karl's layout: Share_Save_* dropped straight into data/
        site_dir,
        Path.cwd(),
    ]
    for c in candidates:
        if c.is_dir() and any(p.is_dir() for p in c.glob("Share_*")):
            return c
    return None


if __name__ == "__main__":
    site_dir = Path(__file__).parent
    if len(sys.argv) == 2:
        root = Path(sys.argv[1]).expanduser()
        if not root.is_dir():
            sys.exit(f"Not a folder: {root}")
    elif len(sys.argv) == 1:
        root = find_data_root(site_dir)
        if root is None:
            sys.exit(
                "No path given and couldn't auto-find a folder containing "
                "Share_* subfolders (checked ./airbnb_data, ../airbnb_data, "
                "this folder, and the current working directory).\n\n" + __doc__
            )
        print(f"Auto-detected data folder: {root}")
    else:
        print(__doc__)
        sys.exit(1)
    build(root, site_dir)
