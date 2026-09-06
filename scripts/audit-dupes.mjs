// Report which rows on the live /events/ calendar the dedupe logic would
// collapse. Reads the published page (which already reflects every Include
// row in the tracker) and runs src/lib/dedupe.ts over it.
//
//   node --experimental-strip-types scripts/audit-dupes.mjs [url]

import { dedupeRows } from '../src/lib/dedupe.ts';

const url = process.argv[2] || 'https://litchfieldledger.com/events/';
const html = await (await fetch(url)).text();

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, '')
    .trim();

const rows = [];
const dayRe = /<div class="cal-day" data-date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)(?=<div class="cal-day" data-date=|<\/section>)/g;
for (const [, date, body] of html.matchAll(dayRe)) {
  const itemRe =
    /<li class="cal-item"[^>]*>\s*<a href="([^"]*)"[\s\S]*?<span class="cal-time">([\s\S]*?)<\/span>[\s\S]*?<span class="cal-name">([\s\S]*?)<\/span>\s*<span class="cal-place">([\s\S]*?)<\/span>/g;
  for (const [, href, timeRaw, nameRaw, placeRaw] of body.matchAll(itemRe)) {
    const [time = '', endTime = ''] = decode(timeRaw).split(/\s*[–-]\s*/);
    const place = decode(placeRaw);
    const [venue = '', town = ''] = place.includes('·') ? place.split(/\s*·\s*/) : [place, ''];
    rows.push({
      date,
      time: time.trim(),
      endTime: endTime.trim(),
      name: decode(nameRaw),
      venue,
      town,
      address: '',
      url: /beehiiv\.com/.test(href) ? '' : decode(href),
    });
  }
}

const merges = [];
const kept = dedupeRows(rows, (k, d) => merges.push([k, d]));

console.log(`${rows.length} rows on ${url}`);
console.log(`${kept.length} after dedupe, ${rows.length - kept.length} collapsed\n`);
for (const [k, d] of merges) {
  console.log(`${k.date} ${k.time.padEnd(8)} KEEP  ${k.name}  [${[k.venue, k.town].filter(Boolean).join(' · ')}]`);
  console.log(`${''.padEnd(19)} DROP  ${d.name}  [${[d.venue, d.town].filter(Boolean).join(' · ')}]\n`);
}
