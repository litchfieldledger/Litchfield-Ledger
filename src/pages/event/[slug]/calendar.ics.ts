// Add-to-calendar file for each event page: /event/<slug>/calendar.ics
import type { APIRoute } from 'astro';
import { getCalendarDays } from '../../../lib/events';
import type { CalendarEvent } from '../../../lib/events';
import { icsFor } from '../../../lib/event-page';

export async function getStaticPaths() {
  const days = await getCalendarDays();
  return days.flatMap((d) => d.events).map((ev) => ({ params: { slug: ev.slug }, props: { ev } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(icsFor((props as { ev: CalendarEvent }).ev), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
