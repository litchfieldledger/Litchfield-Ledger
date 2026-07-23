// One-off/occasional builder: turn a raw Event Tracker dump into the committed
// seed snapshot (src/data/events-seed.json) that lets the map render without
// live Airtable credentials. In production the map fetches live (see
// src/lib/events.ts); this seed is the offline fallback + prototype data.
//
// Usage: node scripts/build-map-seed.mjs <raw-airtable-dump.json>
//   dump = the { records: [...] } JSON from list_records_for_table.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mapRow } from './lib-events-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'src/data/events-seed.json');

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('Usage: node scripts/build-map-seed.mjs <raw-airtable-dump.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(dumpPath, 'utf8'));
const records = raw.records || [];
const events = records
  .map(mapRow)
  .filter((e) => e.name && e.date && e.geo);

// Stable sort by date then name.
events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'Event Tracker · AI Decision = Include · future-dated',
  count: events.length,
  events,
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${events.length} events → ${OUT}`);
