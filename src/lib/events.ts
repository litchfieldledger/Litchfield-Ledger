// Build-time event source for the map page.
//
// Two modes, chosen automatically:
//   1. LIVE  — when AIRTABLE_API_KEY is set, fetch approved/Include future
//      events straight from the Event Tracker base. This is the "synced to the
//      scraper + Airtable" path.
//   2. SEED  — otherwise, read the committed snapshot (src/data/events-seed.json)
//      so the site still builds (and the prototype renders) without secrets.
//
// Either way, each event is joined to the committed geocode cache
// (src/data/geocache.json) to attach lat/lng. Locations missing from the cache
// are logged and skipped — run `node scripts/geocode.mjs` after a scrape to
// fill them in, then commit the updated cache.

import geocache from '../data/geocache.json';
import aliases from '../data/geo-aliases.json';
import seed from '../data/events-seed.json';

const BASE_ID = 'apprsKJr6ge2bytOh';
const TABLE_ID = 'tblOuZCYYHK1u41TD';
const API_KEY = import.meta.env.AIRTABLE_API_KEY;

// Which pool of events to publish. The human review queue (Status = Approved /
// Approved checkbox) is the eventual gate; today it is barely populated, so the
// prototype publishes the AI-ranked "Include" set. Flip SOURCE_FILTER to
// 'approved' once you're curating in Airtable.
const SOURCE_FILTER: 'ai-include' | 'approved' = 'ai-include';

const FIELD = {
  name: 'Event Name',
  date: 'Event Date',
  time: 'Event Time',
  endTime: 'End time',
  address: 'Event Address',
  venue: 'Venue name',
  url: 'URL',
  listingUrl: 'Original Listing URL',
  source: 'Source Name',
} as const;

export type MapEvent = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string;
  endTime: string;
  venue: string;
  address: string;
  town: string;
  url: string;
  source: string;
  category: Category;
  lat: number;
  lng: number;
  precise: boolean;
};

export type Category = 'music' | 'market' | 'art' | 'talk' | 'outdoors' | 'community';

export const CATEGORY_META: Record<Category, { label: string; color: string; emoji: string }> = {
  music: { label: 'Live music', color: '#c85c1e', emoji: '♪' },
  market: { label: 'Markets & fairs', color: '#7a8450', emoji: '▲' },
  art: { label: 'Art & stage', color: '#8a5a83', emoji: '◆' },
  talk: { label: 'Talks & classes', color: '#3f6f8f', emoji: '●' },
  outdoors: { label: 'Outdoors', color: '#1e3d28', emoji: '✦' },
  community: { label: 'Community', color: '#b0872f', emoji: '★' },
};

const CATEGORY_RULES: [Category, RegExp][] = [
  ['music', /\b(concert|music|jazz|band|orchestra|quartet|trio|sonata|singer|songwriter|choir|chorus|symphony|acoustic|recital|dj|tribute|blues|folk|opera|ceili)\b/i],
  ['market', /\b(market|farmers?|flea|bazaar|brocante|craft fair|makers|vendor|tag sale|rummage)\b/i],
  ['outdoors', /\b(hike|hikes|walk|trail|garden|nature|birding|bird walk|preserve|farm tour|forest|river|paddle|kayak|park|clean-?up|scavenger|wildflower|foraging|trout|fishing)\b/i],
  ['art', /\b(art|gallery|exhibit|exhibition|studio|painting|paint|sculpture|photography|pottery|ceramics|film|movie|screening|theater|theatre|play|dance)\b/i],
  ['talk', /\b(talk|author|lecture|reading|book|poetry|discussion|panel|workshop|class|seminar|lesson|storytime|history|genealogy|library)\b/i],
  ['community', /\b(town hall|meeting|voting|vote|election|primary|selectmen|board of|hearing|fundraiser|benefit|supper|dinner|breakfast|potluck|festival|fair|celebration|parade|blood drive|tasting|wine|beer|brewery|bbq|barbecue)\b/i],
];

function categorize(name = ''): Category {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(name)) return cat;
  return 'community';
}

function geocodeQuery(address = '', venue = ''): string {
  let q = (address || '').trim();
  if (!q) q = (venue || '').trim();
  if (!q) return '';
  if (/\b(CT|Connecticut|NY|New York|MA|Massachusetts)\b/i.test(q)) return q;
  return `${q}, CT`;
}

// Best-effort town extraction for the popup subtitle: the last comma-part that
// isn't a state/zip, else the aliased town.
function townFrom(address: string, geo: string): string {
  const parts = (address || '').split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (/^\d{5}(-\d{4})?$/.test(p)) continue;
    if (/^(CT|Connecticut|NY|New York|MA|Massachusetts)$/i.test(p)) continue;
    if (/\d/.test(p) && i === 0) continue; // skip a bare street-number-first part
    return p.replace(/\b(CT|Connecticut|NY)\b\.?$/i, '').trim() || p;
  }
  // Fall back to the alias target's town, if any.
  const alias = (aliases as Record<string, string>)[geo];
  if (alias) {
    const ap = alias.split(',').map((s) => s.trim());
    if (ap.length >= 2) return ap[ap.length - 2];
  }
  return '';
}

type RawFields = Record<string, string | undefined>;

function toMapEvent(id: string, f: RawFields): MapEvent | null {
  const name = (f[FIELD.name] || '').trim();
  const date = (f[FIELD.date] || '').trim();
  const address = (f[FIELD.address] || '').trim();
  const venue = (f[FIELD.venue] || '').trim();
  const geo = geocodeQuery(address, venue);
  if (!name || !date || !geo) return null;

  const hit = (geocache as Record<string, { lat: number; lng: number; precision: string } | null>)[geo];
  if (!hit) {
    missingGeo.add(geo);
    return null;
  }

  return {
    id,
    name,
    date,
    time: (f[FIELD.time] || '').trim(),
    endTime: (f[FIELD.endTime] || '').trim(),
    venue,
    address,
    town: townFrom(address, geo),
    url: (f[FIELD.url] || f[FIELD.listingUrl] || '').trim(),
    source: (f[FIELD.source] || '').trim(),
    category: categorize(name),
    lat: hit.lat,
    lng: hit.lng,
    precise: hit.precision === 'precise',
  };
}

const missingGeo = new Set<string>();

async function fetchLive(): Promise<RawFields[] | null> {
  if (!API_KEY) return null;

  const today = new Date().toISOString().slice(0, 10);
  const formula =
    SOURCE_FILTER === 'approved'
      ? `AND({Approved}=1, IS_AFTER({Event Date}, '${today}'))`
      : `AND({AI Decision}='Include', IS_AFTER({Event Date}, '${today}'))`;

  const all: RawFields[] = [];
  let offset: string | undefined;
  try {
    do {
      const params = new URLSearchParams({ filterByFormula: formula, pageSize: '100' });
      Object.values(FIELD).forEach((f) => params.append('fields[]', f));
      if (offset) params.set('offset', offset);
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      if (!res.ok) {
        console.error('[events] Airtable fetch failed:', res.status, await res.text());
        return null;
      }
      const json = await res.json();
      for (const rec of json.records ?? []) all.push(rec.fields ?? {});
      offset = json.offset;
    } while (offset);
    return all;
  } catch (err) {
    console.error('[events] Airtable fetch error:', err);
    return null;
  }
}

export async function getMapEvents(): Promise<MapEvent[]> {
  missingGeo.clear();
  const live = await fetchLive();

  let events: MapEvent[];
  if (live) {
    events = live
      .map((f, i) => toMapEvent(`live-${i}`, f))
      .filter((e): e is MapEvent => e !== null);
    console.log(`[events] LIVE: ${events.length} placed from ${live.length} Airtable rows.`);
  } else {
    const seedEvents = (seed.events as any[]).map((e) =>
      toMapEvent(e.id, {
        [FIELD.name]: e.name,
        [FIELD.date]: e.date,
        [FIELD.time]: e.time,
        [FIELD.endTime]: e.endTime,
        [FIELD.address]: e.address,
        [FIELD.venue]: e.venue,
        [FIELD.url]: e.url,
        [FIELD.source]: e.source,
      })
    );
    events = seedEvents.filter((e): e is MapEvent => e !== null);
    console.log(`[events] SEED: ${events.length} placed from ${seed.events.length} snapshot rows (no AIRTABLE_API_KEY).`);
  }

  if (missingGeo.size) {
    console.warn(
      `[events] ${missingGeo.size} location(s) missing from geocache — run \`node scripts/geocode.mjs\` and commit:\n  ` +
        [...missingGeo].join('\n  ')
    );
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  return events;
}
