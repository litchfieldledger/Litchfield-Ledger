// Geocoder for Litchfield Ledger map data.
//
// Reads a list of location query strings, fills in any that are missing from
// src/data/geocache.json using OpenStreetMap's free Nominatim service, and
// writes the cache back. The cache is committed to the repo, so a location is
// only ever geocoded once — subsequent builds are instant and offline.
//
// Usage:
//   node scripts/geocode.mjs                 # geocode queries from the seed snapshot
//   node scripts/geocode.mjs "9 Main St, Kent, CT" "Salisbury, CT"   # ad-hoc
//
// Nominatim usage policy: <=1 request/second, descriptive User-Agent. We honor
// both. Litchfield County spans roughly 41.55–42.05 N, 73.51–72.90 W; we bias
// results to that viewbox so bare town names land in the right place.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_PATH = resolve(ROOT, 'src/data/geocache.json');
const SEED_PATH = resolve(ROOT, 'src/data/events-seed.json');
const ALIAS_PATH = resolve(ROOT, 'src/data/geo-aliases.json');

const USER_AGENT = 'litchfield-ledger-map/1.0 (patrick@purushapeople.com)';
const VIEWBOX = '-73.51,42.05,-72.90,41.55'; // left,top,right,bottom (lon/lat)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function loadAliases() {
  if (!existsSync(ALIAS_PATH)) return {};
  try {
    const a = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
    delete a._comment;
    return a;
  } catch {
    return {};
  }
}

async function geocode(query) {
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

function queriesFromSeed() {
  if (!existsSync(SEED_PATH)) return [];
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const events = Array.isArray(seed) ? seed : seed.events || [];
  return events.map((e) => e.geo).filter(Boolean);
}

async function main() {
  const cliQueries = process.argv.slice(2);
  const queries = cliQueries.length ? cliQueries : queriesFromSeed();
  const unique = [...new Set(queries)];

  const cache = loadCache();
  const aliases = loadAliases();

  // Re-attempt any prior miss (cached null) that now has an alias to try.
  for (const q of Object.keys(aliases)) {
    if (q in cache && cache[q] === null) delete cache[q];
  }

  const missing = unique.filter((q) => !(q in cache));

  console.log(`${unique.length} unique locations, ${missing.length} need geocoding.`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < missing.length; i += 1) {
    const q = missing[i];
    const searchStr = aliases[q] || q;
    try {
      const hit = await geocode(searchStr);
      if (hit) {
        if (aliases[q]) hit.aliasedTo = searchStr;
        cache[q] = hit;
        ok += 1;
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

  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(`Done. ${ok} geocoded, ${fail} unresolved. Cache: ${CACHE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
