// Duplicate collapsing for tracker rows.
//
// The tracker ingests the same event from several sources (organizer site,
// Litchfield Magazine, Tally, Instagram) and each source words the title its
// own way, so exact-name matching misses most of them. Two rows are the same
// event when they share a date and start time and their significant title
// words mostly overlap, unless they are clearly at different venues in
// different towns.
//
// No imports on purpose: scripts/audit-dupes.mjs loads this file directly
// under Node to report what the live calendar would collapse.

export type DedupeRow = {
  date: string; // YYYY-MM-DD
  time: string; // "6:00 PM" or ""
  endTime: string;
  name: string;
  venue: string;
  address: string;
  town: string;
  url: string;
};

export function timeToMinutes(time: string): number {
  const m = (time || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return 24 * 60;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

const TITLE_STOP = new Set(
  'a an the and or of at in on to for with by from vs & @ series presents present featuring feat event events annual weekly monthly free'.split(' ')
);
const VENUE_STOP = new Set(
  'the of and at library center centre hall house park church town memorial community public school inn farm barn gallery museum theatre theater room space main street st rd road ave avenue ct connecticut'.split(' ')
);

function tokens(text: string, stop: Set<string>): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !stop.has(w))
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n / Math.min(a.size, b.size);
}

// How much a row tells the reader; the richer duplicate is the one we keep.
export function richness(e: DedupeRow): number {
  let s = 0;
  if (e.url && !/instagram\.com|facebook\.com/i.test(e.url)) s += 5;
  else if (e.url) s += 1;
  if (e.address) s += 2;
  if (e.venue) s += 1;
  if (e.endTime) s += 1;
  return s;
}

// Significant title words, minus the venue's own words: "Friday Market at
// Wassaic Commons" and "Wassaic Commons Friday Night BYOP" must not match on
// the venue alone.
function titleTokens(e: DedupeRow): Set<string> {
  const t = tokens(e.name, TITLE_STOP);
  for (const w of tokens(e.venue, VENUE_STOP)) t.delete(w);
  return t;
}

export function isSameEvent(a: DedupeRow, b: DedupeRow): boolean {
  if (a.date !== b.date) return false;
  if (timeToMinutes(a.time) !== timeToMinutes(b.time)) return false;
  if (a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) return true;
  if (overlap(titleTokens(a), titleTokens(b)) < 0.6) return false;
  // Similar titles at the same minute, but clearly different places
  // (e.g. "Story Time" at two libraries): keep both.
  const va = tokens(a.venue, VENUE_STOP);
  const vb = tokens(b.venue, VENUE_STOP);
  if (va.size && vb.size && overlap(va, vb) === 0) {
    const ta = (a.town || '').toLowerCase();
    const tb = (b.town || '').toLowerCase();
    if (ta && tb && ta !== tb) return false;
  }
  return true;
}

// Richer wins; on a tie the more specific title ("Movie Mondays ~ Pressure"
// over "Movie Mondays"). Mirrors dedupe_events.py in the ledger-events repo.
function better(candidate: DedupeRow, incumbent: DedupeRow): boolean {
  const rc = richness(candidate);
  const ri = richness(incumbent);
  return rc > ri || (rc === ri && candidate.name.length > incumbent.name.length);
}

// Collapse duplicate rows, keeping the richest copy of each, in input order.
// `onMerge` lets the audit script see what was folded into what.
export function dedupeRows<T extends DedupeRow>(
  rows: T[],
  onMerge?: (kept: T, dropped: T) => void
): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    const i = kept.findIndex((k) => isSameEvent(k, row));
    if (i === -1) {
      kept.push(row);
    } else if (better(row, kept[i])) {
      onMerge?.(row, kept[i]);
      kept[i] = row;
    } else {
      onMerge?.(kept[i], row);
    }
  }
  return kept;
}
