# Tokyo Photo Map — plan and what I need from you

**Live first pass:** <https://herodesign.github.io/tokyo-trip/photos/>
(standalone page in this repo at `photos/`, built on the Field Guide's design system)

The goal: every photo from the trip on a map of Tokyo, pinned where it was taken, organised by the
itinerary. Pick a day, see the route and its stops, tap a stop for its photos, tap a photo for the
lightbox, or press Tour and let it play.

What is on the page today is the real UI with **stand-in data**: the stops are the day assignments
from your plan (`data/my-settings.json`), and the pictures are the guide's Wikimedia photos of those
places, cropped a few ways so stops with several shots look right. Nothing about the layout or the
interactions needs the real photos to be judged.

---

## What I need from you

In rough order of usefulness. Items 1 and 2 are the big ones; the rest are decisions.

### 1. The itinerary export

Tell me which app it actually is. "Wanderlust" did not match an itinerary app with an export feature;
**Wanderlog** is the likely one. Any of these works, best first:

- **A share link.** In the trip: Share → make it viewable by anyone with the link → send me the link.
  I can read the days and stops from the public web view. No login needed, and please don't send me
  your password.
- **A PDF export**, if the app offers one (Wanderlog: trip menu → Export / Print).
- **Screenshots** of each day's list, if neither of the above exists.

What I'll pull out: for each day, the ordered list of stops with names, times and addresses or
coordinates. That becomes `data/trip.json` and replaces the demo stops.

### 2. The photos, with their location data intact

The pipeline needs each photo's **capture time and GPS**, which iPhones record in the file but strip
on most sharing paths. The export has to keep them:

**On the iPhone** — Photos → Select the photos (or an album) → Share → tap **Options** at the top →
turn **Location** on and pick **All Photos Data** (keeps HEIC originals) or **Most Compatible**
(converts to JPEG, still keeps location) → AirDrop to a Mac, or Save to Files.

**On a Mac with Photos synced** — select the photos → File → Export → **Export Unmodified
Originals**, or **Export N Photos** with "Location Information" ticked.

Then either:

- drop the folder into `photos/import/` in this repo (gitignored) and run `npm run photos`, which
  does everything below, or
- zip it and send me a Drive / Dropbox / iCloud Drive link and I run it.

Things that *do not* keep GPS, so avoid them: iCloud Shared Album links, iMessage/WhatsApp, AirDrop
with Location switched off. Photos without GPS still get placed, but by clock time against the
itinerary rather than by where you stood.

Also tell me: **one phone or two?** If Ever shot photos too, export from both; the pipeline merges
them by time.

### 3. Everything or a selection?

Easiest: make an album in Photos called something like *Tokyo map*, drag in what you want on the
page, export that. Otherwise send everything and I'll keep bursts and near-duplicates down to one.

### 4. Public or gated? (this one matters)

GitHub Pages is public: anyone with the link can see it, and search engines may index it. With
personal photos, and Ever being 13, decide before the real photos go up:

| Option | How | Cost | Strength |
|---|---|---|---|
| **Public, curated** | Keep faces out or choose photos you'd post anyway | none | none, it's public |
| **Unlisted** | `noindex` meta + an unguessable URL | none | weak, link can be forwarded |
| **Real login** | Move hosting to Cloudflare Pages + Cloudflare Access (email allow-list, free for small teams) or Vercel password protection (paid plan) | free / paid | real |
| **Private** | Keep it off the web; run `npm run dev` locally or AirDrop a build | none | total |

My recommendation: curate for public if you want to send the link around; Cloudflare Access if you
want family-only. Both are a small change to the deploy workflow, not to the page.

### 5. Videos and Live Photos

First pass is stills only. Live Photos export as a JPEG/HEIC plus a `.mov`; the pipeline keeps the
still and lists the movie. Say if you want short videos on the map too (they'd play inline in the
lightbox).

### 6. Captions

Optional. `data/photos.json` has a `caption` field per photo. Simplest is a text file of
`photo id: caption` lines, or I can add an edit mode to the page later.

### 7. "Hosted by Hero Design"

It is at `herodesign.github.io/tokyo-trip/photos/` now. If you want `tokyo.hero-design.com` or
similar, that's a CNAME record at your DNS plus one line in the repo; say the word.

---

## How it will work

```
iPhone export ──► photos/import/        (raw, never committed)
                       │
                       ▼  npm run photos  (scripts/ingest-photos.mjs)
             read EXIF: time, GPS, orientation
             match each photo to a stop in data/trip.json
               ├─ within 250 m of a planned stop that day  → that stop
               ├─ within 1.5 km                            → that stop, flagged
               ├─ further, with GPS                        → a new stop, named after the nearest guide place
               └─ no GPS                                   → slotted by clock time
             resize: 1600 px web copy + 400 px thumbnail, EXIF stripped (no GPS published)
                       │
                       ▼
             data/photos.json + data/trip.json + photos/img/ + photos/thumb/
                       │
                       ▼  git push → GitHub Pages
```

The EXIF reader and the matcher are written and tested (`scripts/exif.mjs`, `photos/lib.js`,
`npm test`). Resizing uses `sharp` if installed, otherwise macOS `sips`, so it runs on your Mac with
nothing to install.

### Phases

| Phase | What | Status |
|---|---|---|
| 0 | The page: map, day routes, stacked photo pins, timeline, stop galleries, lightbox, tour, shareable links | **done, live** |
| 1 | Replace demo stops with the real itinerary (needs item 1) | next |
| 2 | Ingest the real photos (needs item 2); check the matches by eye; fix any stop a photo landed on wrongly | next |
| 3 | Polish: captions, a "where were we" time scrubber, tour mode that moves the map between stops, open-graph preview image, offline cache for the phone | after |
| 4 | Privacy / domain decisions (items 4 and 7) | before the real photos go public |

### Size and hosting

At 1600 px and quality 82, a phone photo is roughly 250–400 KB. 500 photos is about 150 MB in the
repo and on the site, which GitHub Pages handles fine. Past about 1,500 photos I'd move the images
to object storage (Cloudflare R2, free tier) and keep only the JSON in the repo.

### Known rough edges in the first pass

- Map tiles come from Esri, as on the guide's Map tab; the page itself makes no other network calls.
- Stops that share one address (the Nakano Broadway shops) can't be split by zooming, so a tap lists
  them instead.
- Indoor GPS (teamLab, the arena, basements) drifts; the 250 m / 1.5 km bands and the per-day
  restriction are there to absorb that. A few photos will still need a manual nudge; the ingest
  script prints a report of every loose or generated match.
- Timestamps are read as Tokyo local time. If a phone was still on California time for the first
  evening, those photos will land on the wrong day; easy to spot and fix.
