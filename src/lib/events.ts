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
import { dedupeRows, timeToMinutes } from './dedupe';

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
  town: string;
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

  const future = rows
    .map((f, i) => {
      const address = (f[FIELD.address] || '').trim();
      const venue = (f[FIELD.venue] || '').trim();
      return {
        id: (f.id as string) || `ev-${i}`,
        name: (f[FIELD.name] || '').trim(),
        date: (f[FIELD.date] || '').trim(),
        time: (f[FIELD.time] || '').trim(),
        endTime: (f[FIELD.endTime] || '').trim(),
        address,
        venue,
        town: townFrom(address, geocodeQuery(address, venue)),
        url: (f[FIELD.url] || f[FIELD.listingUrl] || '').trim(),
      };
    })
    .filter((e) => e.name && e.date && e.date >= today)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : timeToMinutes(a.time) - timeToMinutes(b.time)
    );
  // The tracker holds the same listing from several sources; show it once.
  return dedupeRows(future);
}

export type CalendarEvent = {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // "6:00 PM" or ""
  endTime: string;
  venue: string;
  address: string;
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
  for (const e of rows) {
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
    days.get(e.date)!.events.push({
      id: e.id,
      name: e.name,
      date: e.date,
      time: e.time,
      endTime: e.endTime,
      venue: e.venue,
      address: e.address,
      town: e.town,
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

// ---------------------------------------------------------------------------
// SEO landing pages: /events/<town>, /events/<category>, /events/this-weekend.

export const CATEGORY_SLUGS: Record<Category, string> = {
  music: 'live-music',
  market: 'farmers-markets',
  art: 'art-and-theater',
  talk: 'talks-and-classes',
  outdoors: 'outdoors',
  community: 'community',
};

export const CATEGORY_PAGES: Record<Category, { title: string; h1: string; intro: string }> = {
  music: {
    title: 'Live Music in Litchfield County, CT This Week',
    h1: 'Live Music in Litchfield County',
    intro: 'Concerts, jazz nights, string quartets, and bands on the green across Northwest Connecticut, from Music Mountain and Infinity Hall to the vineyards and breweries.',
  },
  market: {
    title: 'Farmers Markets & Fairs in Litchfield County, CT',
    h1: 'Farmers Markets & Fairs',
    intro: 'Weekly farmers markets, craft fairs, tag sales, and makers markets across Litchfield County, with days and hours for each.',
  },
  art: {
    title: 'Art Shows, Galleries & Theater in Litchfield County, CT',
    h1: 'Art, Galleries & Theater',
    intro: 'Gallery openings, exhibitions, film screenings, and stage productions across Northwest Connecticut.',
  },
  talk: {
    title: 'Talks, Classes & Workshops in Litchfield County, CT',
    h1: 'Talks, Classes & Workshops',
    intro: 'Author talks, lectures, workshops, and library programs happening across Litchfield County.',
  },
  outdoors: {
    title: 'Hikes, Walks & Outdoor Events in Litchfield County, CT',
    h1: 'Outdoors',
    intro: 'Guided hikes, bird walks, garden tours, paddles, and preserve events across the hills and rivers of Northwest Connecticut.',
  },
  community: {
    title: 'Community Events, Festivals & Fundraisers in Litchfield County, CT',
    h1: 'Community Events',
    intro: 'Festivals, town celebrations, suppers, fundraisers, tastings, and the rest of what brings Litchfield County together.',
  },
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Drop every event that fails `keep`, then drop days left empty.
export function filterDays(days: CalendarDay[], keep: (e: CalendarEvent) => boolean): CalendarDay[] {
  return days
    .map((d) => ({ ...d, events: d.events.filter(keep) }))
    .filter((d) => d.events.length > 0);
}

export type TownEntry = { town: string; slug: string; count: number };

// Towns with enough events to deserve their own landing page.
export function townIndex(days: CalendarDay[], min = 2): TownEntry[] {
  const counts = new Map<string, { town: string; count: number }>();
  for (const d of days) {
    for (const e of d.events) {
      const town = e.town.trim();
      if (!town) continue;
      if (!/^[A-Za-z][A-Za-z .'-]{1,30}$/.test(town)) continue; // skip junk like "CT 06777"
      if (town.split(/\s+/).length > 3) continue;
      const key = town.toLowerCase();
      const cur = counts.get(key) || { town, count: 0 };
      cur.count += 1;
      counts.set(key, cur);
    }
  }
  return [...counts.values()]
    .filter((t) => t.count >= min)
    .map((t) => ({ town: t.town, slug: slugify(t.town), count: t.count }))
    .sort((a, b) => b.count - a.count || a.town.localeCompare(b.town));
}

// Friday–Sunday of the coming weekend (or the current one, if it's Sat/Sun).
export function weekendRange(today: string = todayIso()): { start: string; end: string; label: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  let toFriday = (5 - dow + 7) % 7;
  if (dow === 6) toFriday = -1;
  if (dow === 0) toFriday = -2;
  let start = addDays(today, toFriday);
  const end = addDays(start, 2);
  if (start < today) start = today; // mid-weekend: only what's still ahead
  const long = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const label =
    start === end ? long(start) : sameMonth ? `${long(start)}–${end.slice(8).replace(/^0/, '')}` : `${long(start)}–${long(end)}`;
  return { start, end, label };
}

// "-04:00" / "-05:00" for a given calendar date in Connecticut.
export function nyOffset(date: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-05:00';
  const m = tz.match(/([+-])(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}:${m[3]}` : '-05:00';
}

function toIsoTime(time: string): string | null {
  const mins = timeToMinutes(time);
  if (!time || mins >= 24 * 60) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// schema.org Event objects for a set of days (capped so the JSON-LD stays small).
export function eventsJsonLd(days: CalendarDay[], pageUrl: string, cap = 120): object {
  const items: object[] = [];
  outer: for (const d of days) {
    for (const e of d.events) {
      if (items.length >= cap) break outer;
      const offset = nyOffset(e.date);
      const start = toIsoTime(e.time);
      const end = toIsoTime(e.endTime);
      const ev: Record<string, unknown> = {
        '@type': 'Event',
        name: e.name,
        startDate: start ? `${e.date}T${start}${offset}` : e.date,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: {
          '@type': 'Place',
          name: e.venue || e.town || 'Litchfield County, CT',
          address: {
            '@type': 'PostalAddress',
            ...(e.address ? { streetAddress: e.address } : {}),
            ...(e.town ? { addressLocality: e.town } : {}),
            addressRegion: 'CT',
            addressCountry: 'US',
          },
        },
      };
      if (end) ev.endDate = `${e.date}T${end}${offset}`;
      if (e.url) ev.url = e.url;
      items.push(ev);
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: pageUrl,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
}
