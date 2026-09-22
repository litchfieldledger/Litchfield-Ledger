// Formatting helpers for the /event/<slug>/ pages and their .ics files.
import { timeToMinutes } from './dedupe';
import { eventPath } from './events';
import type { CalendarEvent } from './events';

const SITE = 'https://litchfieldledger.com';
const DEFAULT_MINUTES = 120; // events posted without an end time

export function whenLong(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function timeRange(time: string, endTime: string): string {
  if (!time) return '';
  return endTime ? `${time} – ${endTime}` : time;
}

// ["Venue", "Street, Town"]: the venue first, then the address when it adds something.
export function placeLine(ev: CalendarEvent): string[] {
  const lines: string[] = [];
  if (ev.venue) lines.push(ev.venue);
  const addr = ev.address && ev.address.toLowerCase() !== ev.venue.toLowerCase() ? ev.address : '';
  if (addr) lines.push(addr);
  else if (ev.town && !lines.some((l) => l.toLowerCase().includes(ev.town.toLowerCase()))) lines.push(`${ev.town}, CT`);
  return lines;
}

export function mapsUrl(ev: CalendarEvent): string {
  const q = [ev.venue, ev.address || (ev.town ? `${ev.town}, CT` : '')].filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
}

export function metaDescription(ev: CalendarEvent): string {
  const at = [ev.venue, ev.town].filter(Boolean).join(', ');
  const lead = `${whenLong(ev.date)}${ev.time ? `, ${ev.time}` : ''}${at ? ` at ${at}` : ''}.`;
  const body = ev.notes.replace(/\s+/g, ' ').trim();
  const text = body ? `${lead} ${body}` : `${ev.name}: ${lead} Details, directions, and what else is on nearby.`;
  return text.length > 158 ? `${text.slice(0, 155).replace(/\s+\S*$/, '')}…` : text;
}

// Start/end as local wall-clock stamps (YYYYMMDDTHHMMSS), or null for all-day.
function stamps(ev: CalendarEvent): { start: string; end: string } | null {
  const startMin = timeToMinutes(ev.time);
  if (!ev.time || startMin >= 24 * 60) return null;
  let endMin = timeToMinutes(ev.endTime);
  if (!ev.endTime || endMin >= 24 * 60 || endMin <= startMin) endMin = Math.min(startMin + DEFAULT_MINUTES, 23 * 60 + 59);
  const day = ev.date.replace(/-/g, '');
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
  return { start: `${day}T${hhmm(startMin)}`, end: `${day}T${hhmm(endMin)}` };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function location(ev: CalendarEvent): string {
  return [ev.venue, ev.address || (ev.town ? `${ev.town}, CT` : '')].filter(Boolean).join(', ');
}

function details(ev: CalendarEvent): string {
  const page = `${SITE}${eventPath(ev)}`;
  return [ev.notes.slice(0, 600), ev.url ? `Organizer: ${ev.url}` : '', `Via The Litchfield Ledger: ${page}`]
    .filter(Boolean)
    .join('\n\n');
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const t = stamps(ev);
  const dates = t ? `${t.start}/${t.end}` : `${ev.date.replace(/-/g, '')}/${nextDay(ev.date)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.name,
    dates,
    ctz: 'America/New_York',
    details: details(ev),
    location: location(ev),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// RFC 5545 text escaping and 75-octet line folding.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function icsFor(ev: CalendarEvent): string {
  const t = stamps(ev);
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Litchfield Ledger//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.slug}@litchfieldledger.com`,
    `DTSTAMP:${now}`,
    ...(t
      ? [`DTSTART;TZID=America/New_York:${t.start}`, `DTEND;TZID=America/New_York:${t.end}`]
      : [`DTSTART;VALUE=DATE:${ev.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay(ev.date)}`]),
    `SUMMARY:${esc(ev.name)}`,
    `LOCATION:${esc(location(ev))}`,
    `DESCRIPTION:${esc(details(ev))}`,
    `URL:${SITE}${eventPath(ev)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
