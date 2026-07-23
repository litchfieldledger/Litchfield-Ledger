// Shared geocoding core for the Litchfield Ledger map.
//
// Wraps OpenStreetMap's free Nominatim service and the committed geocode cache
// (src/data/geocache.json). A location string is only ever geocoded once; the
// result is cached and committed, so builds are instant and offline.
//
// Nominatim usage policy: <=1 request/second, descriptive User-Agent. Honored.
// Litchfield County spans ~41.55–42.05 N, 73.51–72.90 W; results are biased to
// that viewbox so bare town names land in the right place.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');
export const CACHE_PATH = resolve(ROOT, 'src/data/geocache.json');
export const SEED_PATH = resolve(ROOT, 'src/data/events-seed.json');
export const ALIAS_PATH = resolve(ROOT, 'src/data/geo-aliases.json');

const USER_AGENT = 'litchfield-ledger-map/1.0 (patrick@purushapeople.com)';
const VIEWBOX = '-73.51,42.05,-72.90,41.55'; // left,top,right,bottom (lon/lat)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function saveCache(cache) {
  // Stable key order keeps diffs small and reviewable.
  const ordered = {};
  for (const k of Object.keys(cache).sort()) ordered[k] = cache[k];
  writeFileSync(CACHE_PATH, `${JSON.stringify(ordered, null, 2)}\n`);
}

export function loadAliases() {
  if (!existsSync(ALIAS_PATH)) return {};
  try {
    const a = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
    delete a._comment;
    return a;
  } catch {
    return {};
  }
}

async function geocodeOne(query) {
  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'us',
    viewbox: VIEWBOX,
    bounded: '0', // prefer the box but don't hard-restrict (some venues sit just outside)
    q: query,
  });
  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${query}"`);
  const rows = await res.json();
  if (!rows.length) return null;
  const r = rows[0];
  return {
    lat: Number(Number(r.lat).toFixed(6)),
    lng: Number(Number(r.lon).toFixed(6)),
    // "precision": house/building = precise; anything else (town, road) is approximate.
    precision: /house|building|residential|amenity|shop|leisure|tourism/i.test(r.type || '')
      ? 'precise'
      : 'approx',
    display: r.display_name,
  };
}

// Geocode every query not already in `cache`, mutating `cache` in place.
// Honors the alias table (rewrites unresolvable venue strings). Returns a
// summary; `added` is how many NEW resolved entries landed (drives whether a
// CI run has anything worth committing).
export async function geocodeMissing(queries, cache) {
  const aliases = loadAliases();

  // Re-attempt any prior miss (cached null) that now has an alias to try.
  for (const q of Object.keys(aliases)) {
    if (q in cache && cache[q] === null) delete cache[q];
  }

  const unique = [...new Set(queries.filter(Boolean))];
  const missing = unique.filter((q) => !(q in cache));

  console.log(`${unique.length} unique locations, ${missing.length} need geocoding.`);
  let added = 0;
  let fail = 0;
  for (let i = 0; i < missing.length; i += 1) {
    const q = missing[i];
    const searchStr = aliases[q] || q;
    try {
      const hit = await geocodeOne(searchStr);
      if (hit) {
        if (aliases[q]) hit.aliasedTo = searchStr;
        cache[q] = hit;
        added += 1;
        console.log(`  [${i + 1}/${missing.length}] ✓ ${q} → ${hit.lat},${hit.lng} (${hit.precision})`);
      } else {
        cache[q] = null; // remember the miss so we don't re-hit it every run
        fail += 1;
        console.log(`  [${i + 1}/${missing.length}] ✗ no match: ${q}`);
      }
    } catch (err) {
      fail += 1;
      console.log(`  [${i + 1}/${missing.length}] ! error: ${q} — ${err.message}`);
    }
    await sleep(1100); // stay under 1 req/sec
  }
  return { unique: unique.length, missing: missing.length, added, fail };
}
