// Shared helpers for turning raw Event Tracker rows into map-ready events.
// Used by both the seed builder (scripts/build-map-seed.mjs) and, in spirit,
// mirrors the mapping in src/lib/events.ts so the two never drift far.

// Field IDs in the Event Tracker "Events" table (base apprsKJr6ge2bytOh).
export const F = {
  name: 'fldbkXPdw747dEZHv',
  date: 'fldjRccB7Ytnn5IV9',
  time: 'fldtnVpJaXvKpR8pY',
  endTime: 'fldX1MOZHEo2EMhdT',
  address: 'fldq37cES7av0xj1T',
  venue: 'fldhfxkVUDBTOg9hL',
  url: 'fldMer0OV7qTjJdtY',
  listingUrl: 'fld4zoa0RndNoocMG',
  source: 'fldqhKoCSYawmI0tB',
};

// Six brand-aligned categories, keyword-matched against the event name.
// Order matters: first match wins.
const CATEGORY_RULES = [
  ['music', /\b(concert|music|jazz|band|orchestra|quartet|trio|sonata|singer|songwriter|choir|chorus|symphony|acoustic|recital|dj|tribute|blues|folk|opera|ceili)\b/i],
  ['market', /\b(market|farmers?|flea|bazaar|brocante|craft fair|makers|vendor|tag sale|rummage)\b/i],
  ['outdoors', /\b(hike|hikes|walk|trail|garden|nature|birding|bird walk|preserve|farm tour|forest|river|paddle|kayak|park|clean-?up|scavenger|wildflower|foraging|trout|fishing)\b/i],
  ['art', /\b(art|gallery|exhibit|exhibition|studio|painting|paint|sculpture|photography|pottery|ceramics|film|movie|screening|theater|theatre|play|dance)\b/i],
  ['talk', /\b(talk|author|lecture|reading|book|poetry|discussion|panel|workshop|class|seminar|lesson|storytime|history|genealogy|library)\b/i],
  ['community', /\b(town hall|meeting|voting|vote|election|primary|selectmen|board of|hearing|fundraiser|benefit|supper|dinner|breakfast|potluck|festival|fair|celebration|parade|blood drive|tasting|wine|beer|brewery|bbq|barbecue)\b/i],
];

export function categorize(name = '') {
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(name)) return cat;
  }
  return 'community';
}

// Build the string we hand to the geocoder. Precise addresses pass through;
// bare town names ("Salisbury") get ", CT" so they resolve to a town center.
export function geocodeQuery(address = '', venue = '') {
  let q = (address || '').trim();
  if (!q) q = (venue || '').trim();
  if (!q) return '';
  // Already region-qualified? leave it.
  if (/\b(CT|Connecticut|NY|New York|MA|Massachusetts)\b/i.test(q)) return q;
  return `${q}, CT`;
}

export function mapRow(rec) {
  const c = rec.cellValuesByFieldId || {};
  const name = (c[F.name] || '').trim();
  const address = (c[F.address] || '').trim();
  const venue = (c[F.venue] || '').trim();
  return {
    id: rec.id,
    name,
    date: c[F.date] || '',
    time: (c[F.time] || '').trim(),
    endTime: (c[F.endTime] || '').trim(),
    address,
    venue,
    url: (c[F.url] || c[F.listingUrl] || '').trim(),
    source: (c[F.source] || '').trim(),
    category: categorize(name),
    geo: geocodeQuery(address, venue),
  };
}
