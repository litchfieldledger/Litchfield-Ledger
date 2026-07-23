// Refresh the map's data from live Airtable, then geocode any new venues.
//
// Pulls future "Include" events from the Event Tracker base, rewrites the seed
// snapshot (src/data/events-seed.json), and fills src/data/geocache.json for any
// location not already cached. Meant to run in CI weekly (see
// .github/workflows/refresh-map-data.yml) so brand-new venues get pins without
// anyone running the geocoder by hand.
//
// Requires AIRTABLE_API_KEY (read access to the Event Tracker base). If the key
// is missing or the fetch fails, it exits WITHOUT touching the committed files,
// so a transient outage can never wipe good data.
//
// Exit status is always 0 on a clean run; the caller decides whether to commit
// based on whether geocache.json actually changed.

import { readFileSync, writeFileSync } from 'node:fs';
import { mapRow } from './lib-events-shared.mjs';
import { loadCache, saveCache, geocodeMissing, SEED_PATH, CACHE_PATH } from './geocode-core.mjs';

const BASE_ID = 'apprsKJr6ge2bytOh';
const TABLE_ID = 'tblOuZCYYHK1u41TD';
const API_KEY = process.env.AIRTABLE_API_KEY;

// Field IDs to request (mirrors scripts/lib-events-shared.mjs `F`).
const FIELD_IDS = [
  'fldbkXPdw747dEZHv', // Event Name
  'fldjRccB7Ytnn5IV9', // Event Date
  'fldtnVpJaXvKpR8pY', // Event Time
  'fldX1MOZHEo2EMhdT', // End time
  'fldq37cES7av0xj1T', // Event Address
  'fldhfxkVUDBTOg9hL', // Venue name
  'fldMer0OV7qTjJdtY', // URL
  'fld4zoa0RndNoocMG', // Original Listing URL
  'fldqhKoCSYawmI0tB', // Source Name
];

async function fetchEvents() {
  const today = new Date().toISOString().slice(0, 10);
  const formula = `AND({AI Decision}='Include', IS_AFTER({Event Date}, '${today}'))`;

  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({
      filterByFormula: formula,
      pageSize: '100',
      returnFieldsByFieldId: 'true',
    });
    FIELD_IDS.forEach((f) => params.append('fields[]', f));
    if (offset) params.set('offset', offset);

    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const json = await res.json();
    for (const rec of json.records ?? []) records.push(rec);
    offset = json.offset;
  } while (offset);

  return records;
}

async function main() {
  if (!API_KEY) {
    console.error('AIRTABLE_API_KEY not set — skipping refresh (committed files untouched).');
    process.exit(0);
  }

  let records;
  try {
    records = await fetchEvents();
  } catch (err) {
    console.error(`Airtable fetch failed — leaving committed files untouched: ${err.message}`);
    process.exit(0);
  }

  // REST returns fields keyed by field id under `fields`; adapt to the shape
  // mapRow expects (`cellValuesByFieldId`).
  const events = records
    .map((rec) => mapRow({ id: rec.id, cellValuesByFieldId: rec.fields || {} }))
    .filter((e) => e.name && e.date && e.geo);

  if (!events.length) {
    console.error('Airtable returned 0 usable events — leaving committed files untouched.');
    process.exit(0);
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  writeFileSync(
    SEED_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'Event Tracker · AI Decision = Include · future-dated',
        count: events.length,
        events,
      },
      null,
      2
    )}\n`
  );
  console.log(`Wrote ${events.length} events → ${SEED_PATH}`);

  const cacheBefore = readFileSync(CACHE_PATH, 'utf8');
  const cache = loadCache();
  const { added, fail } = await geocodeMissing(events.map((e) => e.geo), cache);
  saveCache(cache);
  const cacheAfter = readFileSync(CACHE_PATH, 'utf8');

  console.log(
    `Geocode: ${added} new, ${fail} unresolved. Cache ${cacheBefore === cacheAfter ? 'unchanged' : 'updated'}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
