// Cleanup for what sources type into the tracker: clock times in every format,
// the odd AM/PM slip, and dates pasted onto the end of titles.
//
// No imports on purpose, so it can be tried against live rows under plain Node.

type Clock = { mins: number; meridiem: 'am' | 'pm' | '' };

function parseClock(raw: string): Clock | null {
  const m = (raw || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i) ?? (raw || '').trim().match(/^(\d{1,2}):(\d{2})()$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const meridiem = (m[3] || '').toLowerCase() === 'a' ? 'am' : (m[3] || '').toLowerCase() === 'p' ? 'pm' : '';
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  return { mins: h * 60 + min, meridiem };
}

function formatClock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const min = mins % 60;
  const h = h24 % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

const HOUR = 60;

// "4:00pm" → "4:00 PM". An end time with no AM/PM ("5:30 PM – 7:00") takes the
// reading that ends soonest after the start. Two slips are corrected, both
// seen on the calendar: a start keyed as AM when it's PM ("6:00 AM – 8:00 PM"
// for an evening concert) and a span over twelve hours ("10:00 AM – 11:00 PM"
// for a lecture). The first becomes 6–8 PM; for the second there's no telling
// which end is wrong, so only the start is kept. Anything unparseable is left
// exactly as typed.
export function tidyTimes(time: string, endTime: string): [string, string] {
  const t = (time || '').trim();
  const e = (endTime || '').trim();
  const start = parseClock(t);
  if (!start) return [t, e];
  let s = start.mins;
  const end = e ? parseClock(e) : null;
  if (!end) return [formatClock(s), e];
  let en = end.mins;
  // One side typed without AM/PM borrows the reading closest to the other.
  if (!end.meridiem && en < 12 * HOUR && en <= s) en += 12 * HOUR;
  if (!start.meridiem && s < 12 * HOUR && s + 12 * HOUR <= en) s += 12 * HOUR;

  // Before 7 am and ending in the evening: the start's AM is a typo.
  if (start.meridiem === 'am' && s < 7 * HOUR && en >= 12 * HOUR && en - (s + 12 * HOUR) > 0 && en - (s + 12 * HOUR) <= 6 * HOUR) {
    s += 12 * HOUR;
  }
  const span = en - s;
  // Past midnight is fine for a late show; otherwise the end is suspect.
  const overnight = span < 0 && en <= 3 * HOUR;
  if (s === 0 && en >= 23 * HOUR + 59) return [formatClock(s), formatClock(en)]; // all day
  if (span > 12 * HOUR || (span <= 0 && !overnight)) return [formatClock(s), ''];
  return [formatClock(s), formatClock(en)];
}

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const WEEKDAY = '(mon|tues?|wed(nes)?|thu(rs?)?|fri|sat(ur)?|sun)(day)?\\.?';

// "Fall Saunters: Johnson Farm – Thursday, October 15, 2026" → "Fall Saunters:
// Johnson Farm". The row already has its date; the pasted copy just makes two
// listings of one event look different. Also "– 10/9". Date ranges
// ("Sept. 27 through Oct. 18") carry information and are left alone.
const TRAILING_DATE = new RegExp(
  `\\s*[,–—-]\\s*(${WEEKDAY},?\\s+)?(${MONTH}\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}(/\\d{2,4})?)\\s*$`,
  'i'
);

export function tidyName(name: string): string {
  const n = (name || '').trim().replace(/\s+/g, ' ');
  if (/\b(through|thru|until)\b/i.test(n)) return n;
  const cut = n.replace(TRAILING_DATE, '').trim();
  return cut.length >= 4 ? cut : n;
}
