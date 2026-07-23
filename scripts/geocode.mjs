// Standalone geocoder — fills src/data/geocache.json from the seed snapshot's
// locations, or from location strings passed on the command line.
//
// Usage:
//   node scripts/geocode.mjs                 # geocode queries from the seed snapshot
//   node scripts/geocode.mjs "9 Main St, Kent, CT" "Salisbury, CT"   # ad-hoc
//
// To geocode straight from live Airtable instead (picks up brand-new venues),
// use scripts/refresh-map-data.mjs with AIRTABLE_API_KEY set.

import { readFileSync, existsSync } from 'node:fs';
import { loadCache, saveCache, geocodeMissing, SEED_PATH, CACHE_PATH } from './geocode-core.mjs';

function queriesFromSeed() {
  if (!existsSync(SEED_PATH)) return [];
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const events = Array.isArray(seed) ? seed : seed.events || [];
  return events.map((e) => e.geo).filter(Boolean);
}

async function main() {
  const cliQueries = process.argv.slice(2);
  const queries = cliQueries.length ? cliQueries : queriesFromSeed();

  const cache = loadCache();
  const { added, fail } = await geocodeMissing(queries, cache);
  saveCache(cache);
  console.log(`Done. ${added} geocoded, ${fail} unresolved. Cache: ${CACHE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
