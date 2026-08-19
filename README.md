# Tokyo Field Guide

A filterable, photo-forward field guide to Tokyo for **Alan and Ever**, built for the phone you'll
actually be holding on the Ginza line. 65 places, each with a real photo, a theme tag, a
neighborhood, a one-line description, the reason it got flagged, and one tap to Google Maps.

Three views: **Browse** (filterable cards), **Map** (every place as a pin), **Plan** (favorites
slotted into trip days, plus Google My Maps export).

---

## The trip

| | |
|---|---|
| **Dates** | 7 nights, Fri 16 Oct → Sat 24 Oct 2026 |
| **Out** | JL001 SFO → HND, 11:55 → 15:05 (+1), nonstop |
| **Back** | JL002 HND → SFO, 18:05 → 11:15, A350-1000 |
| **Base** | Asakusa |
| **Travellers** | Alan + Ever (13) — everything in here is age-appropriate |

**Organizing themes:** capybara, drums, photography, drawing, VR, ramen, audio sampling, plus
shopping tracks for synths/electronic gear and menswear/raw denim.

**The throughline** is rhythm and sound: traditional taiko → arcade rhythm games → underground
livehouse. The taiko lesson is the anchor; `Taiko no Tatsujin` in Akihabara is the hi/lo rhyme;
a Shimokitazawa livehouse gig closes the loop.

Days in the Plan view run 16–24 Oct, with the two travel days marked.

---

## Run it locally

No install step, no bundler, no dependencies.

```bash
npm run dev
```

Then open <http://localhost:5173>. Edit any file and refresh — that's the whole loop.

**On your phone (same Wi‑Fi):**

```bash
npm run dev:lan
```

The terminal prints your machine's LAN address (e.g. `http://192.168.1.42:5173`). Open that in
Safari on your phone. Add to Home Screen if you want it to feel like an app.

| Script | What it does |
|---|---|
| `npm run dev` | Static file server on :5173 (localhost only) |
| `npm run dev:lan` | Same server, reachable from your phone on the same network |
| `npm test` | Dataset, filter and export tests (`node:test`, no deps) |
| `npm run build` | Copies the publishable files into `dist/` |
| `npm run images` | Fetches any missing place photos into `images/` |
| `npm run images:force` | Re-fetches every photo |
| `npm run export` | Writes `data/export/tokyo-field-guide.{kml,csv}` |
| `npm run vendor` | Re-downloads the self-hosted fonts and Leaflet |

---

## Deploy

The site is plain static files. `npm run build` just assembles `dist/`.

### GitHub Pages (already wired)

`.github/workflows/deploy-pages.yml` builds and deploys on every push to `main` to the
`gh-pages` branch. One-time setup:

1. **The repo must be public** (or your account needs GitHub Pro/Team — GitHub Free cannot
   publish Pages from a private repo, and the site will 404).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / (root).**

The site lands at `https://herodesign.github.io/tokyo-trip/`. Every asset path is relative, so the
`/tokyo-trip/` subpath works with no configuration.

### Vercel

```bash
npx vercel --prod
```

Or import the repo at vercel.com. `vercel.json` sets long-lived caching for `/images`. If Vercel
asks: build command `npm run build`, output directory `dist`.

**On your phone:** open the deployed URL in Safari → Share → *Add to Home Screen*. It behaves like
an app, and the fonts, photos and Leaflet are all served from the site itself.

---

## Photos — how this works

This is the part that kept breaking in sandboxes, so it's deliberate:

**Photos are fetched at build time and committed into `images/`. The running site never makes a
network call to an external image service.** It only ever loads `images/<place-id>.jpg` from its
own origin.

`npm run images` resolves each place through, in order:

1. `en.wikipedia.org` page image (following redirects)
2. `ja.wikipedia.org` page image
3. Wikimedia Commons file search

Three things that make it reliable, learned by watching it fail:

- **Only API-returned URLs are downloaded.** Wikimedia rejects hand-built thumbnail URLs with
  `HTTP 400 — use thumbnail sizes listed`, which is how you end up with a folder of 2KB HTML error
  pages named `.jpg` that look fine until a browser tries to decode them.
- **Bytes are checked against image magic numbers** before anything is written, so an error page
  can never be saved as a photo.
- **429s are retried with backoff**, honouring `Retry-After`. The CDN rate-limits bursts, and
  without this about half the set silently comes back empty.

Every file's subject, author, license and source page is recorded in `data/image-credits.json`.
All photos are from Wikimedia Commons / Wikipedia under CC0, CC BY, CC BY-SA, GFDL or public
domain. Current state: **65/65 places have a cached photo, ~14MB total, no two places sharing one.**

If an image is ever missing, the card falls back to a colored tile carrying the place name — this
is a real code path, not a theoretical one.

### Swapping in your own shots

Landmarks show the real place. Commercial spots — camera shops, synth dealers, denim stores, cafes,
hotels — show a **representative subject photo**, not the venue: Map Camera shows a Leica M3,
Five G shows a Jupiter-8, Momotaro shows indigo dye. To replace one:

1. Drop your image at `images/<place-id>.jpg` (same id as in `data/places.json`).
2. Update that place's entry in `data/image-credits.json` (or delete the entry if it's your own
   photo and attribution isn't needed — the card only needs the file to exist).

To re-source one automatically instead, edit its `imageQueries` in `data/places.json` and run:

```bash
node scripts/fetch-images.mjs --only=<place-id> --force
```

---

## Editing the data

Everything lives in [`data/places.json`](data/places.json). One object per place:

```json
{
  "id": "senso-ji",
  "name": "Senso-ji",
  "theme": "photography",
  "type": "see",
  "area": "Asakusa",
  "what": "Tokyo's oldest temple + Nakamise street",
  "why": "The \"downbeat\" temple — 7am, empty, first roll",
  "link": "https://www.senso-ji.jp/",
  "mapQuery": "Senso-ji Asakusa Tokyo Japan",
  "coords": [35.7148, 139.7967],
  "coordPrecision": "exact",
  "imageQueries": ["Sensō-ji", "Kaminarimon"]
}
```

**Themes** — `capybara` `drums` `photography` `drawing` `vr` `ramen` `sampling` `soundgear`
`menswear` `core`
**Types** — `see` `do` `eat` `shop` `animals` `sample` `stay` `trip`

Add a place, run `npm run images`, run `npm test`. The tests will tell you if a theme, type,
coordinate or link is wrong before you deploy.

### Two honest caveats about the data

- **`coordPrecision`.** `exact` means the pin is on the building. `area` means it's a neighborhood
  centroid — several of the small shops (ClockFace Modular, SUBTOKYOSHOP, the Harajuku denim
  strip) have no address I could verify from here. Those pins draw hollow on the map. The **Map**
  button always does a Google Maps *name* search, so navigation is unaffected either way — that's
  the button to trust on the ground.
- **Links.** Every URL was expanded from your shorthand and checked to return 200, except the
  GetYourGuide taiko listing, which blocks scripted requests. It's built from the activity id you
  gave (`t920860`) and needs one click in a real browser to confirm.

---

## Export to Google My Maps

From the **Plan** view, or `npm run export` for the whole set.

1. Download the KML (all places, or just your favorites).
2. Go to [Google My Maps](https://www.google.com/mymaps) → **Create a new map** → **Import**.
3. Upload the KML. Pins arrive colored by theme, with the description and day assignment attached.

That map then shows up in the Google Maps app on your phone under *Saved → Maps*.

CSV is the same data as a spreadsheet, with latitude/longitude columns My Maps also accepts.

---

## Layout

```
index.html              app shell, three views
assets/
  styles.css            the whole design system
  fonts/                self-hosted Bricolage Grotesque + Inter
  js/
    app.js              entry point, hash routing
    data.js             dataset loading, themes, types, trip days
    filter.js           pure filter rules (tested)
    browse.js           card grid, chips, search, count, reset
    card.js             the place card + map popup
    mapview.js          Leaflet map
    plan.js             favorites + day assignment + export buttons
    store.js            localStorage state
    export.js           KML/CSV generators (shared with the build script)
data/
  places.json           the 65 places
  image-credits.json    per-photo author, license, source
  export/               generated KML + CSV
images/                 cached photos, one per place
scripts/                dev server, build, image fetch, vendoring, export
test/                   node:test suite
vendor/leaflet/         self-hosted Leaflet
```

Nothing is fetched from a third party at runtime except OpenStreetMap map tiles, which is inherent
to a slippy map.

---

## Status

Built: the dataset, the card browser with filters, the map view, favorites and assign-to-day, and
the My Maps export. The last three were scoped as "scaffold next" — they're implemented rather
than stubbed, but they're the newest code and the ones most worth kicking the tyres on.

Worth doing before October:
- Swap representative photos for your own shots as you research each spot.
- Pin down addresses for the `area`-precision places and promote them to `exact`.
- Book the time-sensitive things: teamLab Planets (tickets ~late July), Shibuya Sky sunset
  (~1 month out), the otter cafe (~2 weeks out), and check Tokyo Gig Guide in September.

---

## Credits

Photos: Wikimedia Commons and Wikipedia contributors, under the licenses recorded per file in
`data/image-credits.json`.
Fonts: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) and
[Inter](https://github.com/rsms/inter), SIL Open Font License 1.1.
Map: [Leaflet](https://leafletjs.com) (BSD-2-Clause), tiles © OpenStreetMap contributors.
