// Build-time event source for the /events calendar and the homepage
// "This Week" strip.
//
// Two modes, chosen automatically:
//   1. LIVE  — when AIRTABLE_API_KEY is set, fetch approved/Include future
//      events straight from the Event Tracker base. This is the "synced to the
//      scraper + Airtable" path and is what production should run.
//   2. SEED  — otherwise, read the committed snapshot (src/data/events-seed.json)
//      so the site still builds without secrets. Rebuild it with
//      `node scripts/build-events-seed.mjs <airtable-dump.json>`.

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

// Best-effort town extraction for event subtitles: the last comma-part that
// isn't a state/zip, else the aliased town.
function townFrom(address: string, geo: string): string {
  const parts = (address || '').split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    if (/^\d{5}(-\d{4})?$/.test(p)) continue;
    if (/^(CT|Connecticut|NY|New York|MA|Massachusetts)(\s+\d{5}(-\d{4})?)?$/i.test(p)) continue;
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

// ---------------------------------------------------------------------------
// Homepage "This Week" strip.

export type UpcomingEvent = {
  name: string;
  date: string; // YYYY-MM-DD
  month: string; // "MAY"
  day: string; // "21"
  time: string; // "6:00 PM"
  place: string; // "Litchfield, CT"
  url: string;
};

function timeToMinutes(time: string): number {
  const m = (time || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return 24 * 60;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function placeLabel(address: string, venue: string): string {
  const geo = geocodeQuery(address, venue);
  const town = townFrom(address, geo) || venue;
  if (!town) return '';
  if (/\b(CT|Connecticut|NY|New York|MA|Massachusetts)\b/i.test(town)) return town;
  return `${town}, CT`;
}


type FutureRow = {
  id: string;
  name: string;
  date: string;
  time: string;
  endTime: string;
  address: string;
  venue: string;
  url: string;
};

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Every future event from live Airtable (when the key is set) or the committed
// seed, normalised and sorted by date then start time. Shared by the homepage
// strip and the /events calendar.
async function loadFutureRows(today: string): Promise<FutureRow[]> {
  const live = await fetchLive();
  const rows: RawFields[] = live
    ? live
    : (seed.events as any[]).map((e) => ({
        id: e.id,
        [FIELD.name]: e.name,
        [FIELD.date]: e.date,
        [FIELD.time]: e.time,
        [FIELD.endTime]: e.endTime,
        [FIELD.address]: e.address,
        [FIELD.venue]: e.venue,
        [FIELD.url]: e.url,
      }));

  return rows
    .map((f, i) => ({
      id: (f.id as string) || `ev-${i}`,
      name: (f[FIELD.name] || '').trim(),
      date: (f[FIELD.date] || '').trim(),
      time: (f[FIELD.time] || '').trim(),
      endTime: (f[FIELD.endTime] || '').trim(),
      address: (f[FIELD.address] || '').trim(),
      venue: (f[FIELD.venue] || '').trim(),
      url: (f[FIELD.url] || f[FIELD.listingUrl] || '').trim(),
    }))
    .filter((e) => e.name && e.date && e.date >= today)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : timeToMinutes(a.time) - timeToMinutes(b.time)
    );
}

export type CalendarEvent = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // "6:00 PM" or ""
  endTime: string;
  venue: string;
  town: string;
  url: string;
  category: Category;
};

export type CalendarDay = {
  date: string;
  weekday: string; // "Thursday" / "Today" / "Tomorrow"
  label: string; // "September 3"
  month: string; // "SEP"
  day: string; // "3"
  events: CalendarEvent[];
};

// Full upcoming calendar for /events, grouped by date. Every occurrence of a
// recurring event (weekly markets, etc.) gets its own row under its own date.
export async function getCalendarDays(): Promise<CalendarDay[]> {
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const rows = await loadFutureRows(today);

  const days = new Map<string, CalendarDay>();
  const seen = new Set<string>();
  for (const e of rows) {
    // The tracker can hold the same listing from two sources; show it once.
    const key = `${e.date}|${e.time.toLowerCase()}|${e.name.toLowerCase().replace(/\s+/g, ' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!days.has(e.date)) {
      const d = new Date(`${e.date}T12:00:00`);
      const weekday =
        e.date === today
          ? 'Today'
          : e.date === tomorrow
            ? 'Tomorrow'
            : d.toLocaleDateString('en-US', { weekday: 'long' });
      days.set(e.date, {
        date: e.date,
        weekday,
        label: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
        day: String(d.getDate()),
        events: [],
      });
    }
    const geo = geocodeQuery(e.address, e.venue);
    days.get(e.date)!.events.push({
      id: e.id,
      name: e.name,
      date: e.date,
      time: e.time,
      endTime: e.endTime,
      venue: e.venue,
      town: townFrom(e.address, geo),
      url: e.url,
      category: categorize(e.name),
    });
  }
  return [...days.values()];
}

export async function getUpcomingEvents(
  { limit = 3, days = 7 }: { limit?: number; days?: number } = {}
): Promise<UpcomingEvent[]> {
  const today = todayIso();
  const horizon = addDays(today, days);
  const all = await loadFutureRows(today);

  // One slot per distinct event name, so a multi-day exhibition doesn't fill
  // the whole strip.
  const seen = new Set<string>();
  const distinct = all.filter((e) => {
    const key = e.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let picked = distinct.filter((e) => e.date <= horizon).slice(0, limit);
  if (picked.length < limit) picked = distinct.slice(0, limit);

  return picked.map((e) => {
    const d = new Date(`${e.date}T12:00:00`);
    return {
      name: e.name,
      date: e.date,
      month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: String(d.getDate()),
      time: e.time,
      place: placeLabel(e.address, e.venue),
      url: e.url,
    };
  });
}
