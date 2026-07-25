# KARLCON Elite Retreats

A gold-and-glass listings dashboard: landing page with a rotating medallion
hero, a satellite-imagery world map (Esri World Imagery — same tile pattern
as the K1RL Telematics fleet dashboard), a listing grid, and a per-retreat
detail page with a drag/scroll photo gallery.

## Run it

Open `index.html` directly in a browser (double-click it, or right-click →
Open with → Chrome). No server or build step required to *view* it — the
demo ships with one real listing (Baobab House, Share_Save_4040223) so the
site is fully browsable out of the box.

## Wire it to your real data

```
pip install pillow --break-system-packages   # if not already installed
cd karlcon-retreats
python build_manifest.py "C:\Users\taten\OneDrive\Desktop\Space\airbnb_data"
```

This scans every `Share_Save_*` folder under that path, reads each
`info.json`, resizes/optimises every photo in its `images/` folder (max
1920px wide, JPEG q84), and rewrites `data/listings.js` — the single file
the whole site reads from. Re-run any time you add or refresh listings;
it's a full rebuild each time, so it's always safe to re-run.

**Honesty by design:** if a field is missing from the scrape (price,
description, coordinates, amenities), the site shows a plain fallback
("Price on request", no amenities block, no map pin) rather than inventing
copy. Fix it at the scraper and it flows through automatically next build.

## Files

```
index.html            landing page
listing.html           retreat detail + gallery (?id=<listing id>)
css/style.css          the whole design system (tokens at the top)
js/common.js           medallion logo SVG, satellite map helper, nav/reveal
js/app.js              landing page: cards, stats, map pins
js/gallery.js           the photo gallery (see note below)
data/listings.js        generated data — DO NOT hand-edit, re-run the builder
data/listings/<id>/...  optimised photo copies per listing
build_manifest.py      the builder script — point it at airbnb_data
```

## Why the gallery won't snap back to photo 1

An earlier pass built the gallery on the browser's native
`scrollLeft` / `scrollTo()`, with a scroll listener trying to keep the UI
in sync. That's a feedback loop: the listener fights the smooth-scroll
animation mid-flight and resets position to 0. `js/gallery.js` is built
differently on purpose — a single `index` number drives a CSS
`transform: translateX()` on the photo track, and dots/thumbnails/counter
all read from that one number. There's no second system that can fight it,
so Next/Prev, dot clicks, thumbnail clicks, arrow keys, and drag-to-swipe
all stay in sync.

## No logo file this round

This upload didn't include the actual KARLCON logo image (the five images
were Explorer screenshots plus one real listing photo). The medallion mark
— dual gold rings, mountain-peak monogram, mirrored reflection beneath —
is built as inline SVG in `js/common.js` (`medallionSVG()`) so nothing is
missing today. Send the real logo file and I'll swap the SVG glyph for a
traced/embedded version of it in the same rings.
