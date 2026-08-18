/**
 * Build-time photo fetch.
 *
 * Every place gets a real photo cached into images/ so the running site never
 * touches the network for imagery. Two rules learned the hard way:
 *
 *   1. Only download URLs the API hands back. Wikimedia rejects hand-built
 *      thumbnail URLs with HTTP 400 ("use thumbnail sizes listed"), which is
 *      how you end up with a directory full of 2KB HTML error pages that look
 *      like images until they hit a browser.
 *   2. Verify the bytes are actually an image before keeping them.
 *
 * Resolution order per place, first hit wins:
 *   en.wikipedia page image -> ja.wikipedia page image -> Commons file search
 *
 * Usage: npm run images            (skips places already cached)
 *        npm run images:force      (re-fetches everything)
 *        node scripts/fetch-images.mjs --only=<place-id>
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMAGE_DIR = path.join(ROOT, 'images');
const PLACES = path.join(ROOT, 'data', 'places.json');
const CREDITS = path.join(ROOT, 'data', 'image-credits.json');

// Wikimedia asks for a descriptive User-Agent with contact info.
const UA = 'TokyoFieldGuide/1.0 (https://github.com/HeroDesign/tokyo-trip; alan@hero-design.com)';
const THUMB_WIDTH = 960;
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Page image from a Wikipedia article, following redirects. */
async function fromWikipedia(lang, query) {
  const data = await api(`https://${lang}.wikipedia.org/w/api.php`, {
    action: 'query',
    prop: 'pageimages',
    piprop: 'thumbnail|name',
    pithumbsize: String(THUMB_WIDTH),
    redirects: '1',
    titles: query,
  });
  const page = data?.query?.pages?.[0];
  if (!page || page.missing || !page.thumbnail?.source) return null;
  return {
    url: page.thumbnail.source,
    file: page.pageimage,
    via: `${lang}.wikipedia: ${page.title}`,
    subject: page.title,
  };
}

/** Direct file search on Commons, for subjects with no article page image. */
async function fromCommons(query) {
  const data = await api('https://commons.wikimedia.org/w/api.php', {
    action: 'query',
    generator: 'search',
    gsrnamespace: '6', // File:
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
  });
  for (const page of data?.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (info?.thumburl) {
      return {
        url: info.thumburl,
        file: page.title.replace(/^File:/, ''),
        via: `commons search: ${query}`,
        subject: query,
      };
    }
  }
  return null;
}

const stripHtml = (s) => (s ? String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : null);

/** License + attribution for a Commons (or local Wikipedia) file. */
async function licenseFor(file) {
  for (const endpoint of [
    'https://commons.wikimedia.org/w/api.php',
    'https://en.wikipedia.org/w/api.php',
  ]) {
    try {
      const data = await api(endpoint, {
        action: 'query',
        titles: `File:${file}`,
        prop: 'imageinfo',
        iiprop: 'extmetadata|url',
      });
      const page = data?.query?.pages?.[0];
      const meta = page?.imageinfo?.[0]?.extmetadata;
      if (!meta) continue;
      return {
        license: stripHtml(meta.LicenseShortName?.value) || 'see file page',
        licenseUrl: meta.LicenseUrl?.value || null,
        author: stripHtml(meta.Artist?.value) || 'Unknown',
        filePage: page.imageinfo[0].descriptionurl ?? null,
      };
    } catch {
      /* try the next endpoint */
    }
  }
  return { license: 'see file page', licenseUrl: null, author: 'Unknown', filePage: null };
}

/** JPEG / PNG / WebP / GIF magic numbers - cheap guard against HTML error pages. */
function imageKind(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
  return null;
}

/**
 * The image CDN rate-limits bursts with HTTP 429, so back off and retry rather
 * than silently leaving the place without a photo.
 */
async function download(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });

  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt;
    console.warn(`    . rate limited, waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/5)`);
    await sleep(wait);
    return download(url, attempt + 1);
  }

  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const kind = imageKind(buf);
  if (!kind) throw new Error(`not an image (${buf.length} bytes, likely an error page)`);
  return { buf, kind };
}

async function resolve(place) {
  for (const query of place.imageQueries ?? []) {
    for (const attempt of [
      () => fromWikipedia('en', query),
      () => fromWikipedia('ja', query),
      () => fromCommons(query),
    ]) {
      try {
        const hit = await attempt();
        if (hit) return hit;
      } catch (err) {
        console.warn(`    ! ${query}: ${err.message}`);
      }
      await sleep(120); // stay polite with the API
    }
  }
  return null;
}

const places = JSON.parse(await readFile(PLACES, 'utf8'));
const credits = existsSync(CREDITS) ? JSON.parse(await readFile(CREDITS, 'utf8')) : {};
await mkdir(IMAGE_DIR, { recursive: true });

const existing = (await readdir(IMAGE_DIR).catch(() => [])).filter((f) => !f.startsWith('.'));
const targets = places.filter((p) => (ONLY ? p.id === ONLY : true));
const missing = [];

for (const [i, place] of targets.entries()) {
  const cached = existing.find((f) => f.replace(/\.[^.]+$/, '') === place.id);
  if (cached && !FORCE && credits[place.id]) {
    console.log(`[${i + 1}/${targets.length}] ${place.id}: cached`);
    continue;
  }

  console.log(`[${i + 1}/${targets.length}] ${place.id}: fetching`);
  const hit = await resolve(place);
  if (!hit) {
    console.warn('    x no image found - will render the fallback tile');
    missing.push(place.id);
    continue;
  }

  try {
    const { buf, kind } = await download(hit.url);
    if (cached) await unlink(path.join(IMAGE_DIR, cached));
    const filename = `${place.id}.${kind}`;
    await writeFile(path.join(IMAGE_DIR, filename), buf);
    const license = await licenseFor(hit.file);
    credits[place.id] = {
      file: filename,
      subject: hit.subject,
      via: hit.via,
      sourceUrl: hit.url.split('?')[0],
      ...license,
      bytes: buf.length,
    };
    console.log(
      `    ok ${filename} (${Math.round(buf.length / 1024)}KB) - ${hit.subject} [${license.license}]`,
    );
  } catch (err) {
    console.warn(`    x ${err.message}`);
    missing.push(place.id);
  }
  await sleep(600);
}

await writeFile(CREDITS, JSON.stringify(credits, null, 2) + '\n');

const covered = places.filter((p) => credits[p.id]).length;
console.log(`\n${covered}/${places.length} places have a cached photo.`);
if (missing.length) console.log(`fallback tiles: ${missing.join(', ')}`);
