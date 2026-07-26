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

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
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


def build(root: Path, site_dir: Path):
    listings = []
    folders = sorted(root.glob("Share_Save_*"))
    if not folders:
        print(f"No Share_Save_* folders found under {root}")
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


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    root = Path(sys.argv[1]).expanduser()
    if not root.is_dir():
        sys.exit(f"Not a folder: {root}")
    site_dir = Path(__file__).parent
    build(root, site_dir)
