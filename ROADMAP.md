# Roadmap

Where the site is headed, how we'll know it's working, and what has shipped.
Newest work at the top of the log. Update this file whenever something ships
or a goal changes.

## Goals

1. **Grow website traffic.** More people finding the Ledger on the web, not only in the inbox.
2. **Improve the reader experience (CX).** Make the calendar the easiest way to answer "what's on this week in Litchfield County?", so people stay longer and click deeper.
3. **Improve retention.** Turn one-time visitors into returning readers and newsletter subscribers.
4. **Make featured listings worth paying for.** Every featured placement should get measurable attention a sponsor can see.

## How we measure it

Google Analytics 4 is the source of truth (the Netlify free plan keeps only 24 hours of request logs).

| Goal | Metric | Where to find it |
| --- | --- | --- |
| Traffic | Weekly views, whole site and `/events/*` + `/event/*` | GA4 → Pages and screens |
| Traffic | Organic search sessions (event pages are built for Google's event results) | GA4 → Traffic acquisition |
| CX | Avg. engagement time on `/events/` and on `/event/*` pages | GA4 → Pages and screens |
| CX | Homepage → calendar clicks: `events_click` by `link_location` (`hero`, `this_week_button`, `home_chip`, `this_week`) | GA4 → Events |
| CX | Calendar → event page clicks: `event_click` | GA4 → Events |
| CX | Deeper browsing: `event_click` from `event_nearby` / `event_same_day` | GA4 → Events |
| Retention | Returning users; newsletter signups from the site (`newsletter_form_click`, Beehiiv acquisition source `litchfieldledger.com`) | GA4 + Beehiiv |
| Retention | Saves and shares: `event_calendar_add`, `event_share` | GA4 → Events |
| Sponsors | Clicks on featured placements: `event_click` with `featured`, `calendar_featured`, `this_week_featured`; `event_outbound_click` from the event page | GA4 → Events |

`event_click` changed meaning on 2026-09-22: before, it was a click out to the
organizer's site; now it opens the on-site event page. Organizer click-outs are
`event_outbound_click`. Don't compare the two periods directly.

### Baseline (before the 2026-09-22 changes)

| Metric | Value |
| --- | --- |
| Calendar views / week | ~65–100 (launched ~Sep 1; 97 week of Sep 7, 65 week of Sep 14) |
| Homepage views / week | ~40–90 |
| Avg. engagement, `/events/` | ~47s |
| Avg. engagement, homepage | 9s (Aug 25–Sep 22) |
| Homepage "View all events" clicks | 8 in 3 weeks |
| Calendar filter use | 11 uses by 4 people in 3 weeks |
| Clicks from the calendar to events | 147 by 61 people in 3 weeks |
| Newsletter | ~4,000 subscribers, ~48% open rate (~1,930 opens per issue), ~3% click rate |

**Next check-in: around 2026-10-13.** Compare three weeks after the changes against the rows above.

## Shipped

### 2026-09-22

**Calendar UX** (`27edc70`)
- Phones: listings now appear on the first screen (were ~1,000px down). Intro clamps to two lines; browse links and category filters are single swipeable rows.
- Events without an organizer link no longer fall back to the submit-event form.
- Journal issue pages got a "Things to do" link in the header.
- Long bare URLs in newsletter HTML wrap instead of widening the page on phones.

**On-site event pages** (`8cc7a61`)
- Every upcoming event has a page at `/event/<name>-<date>/`: date and time, venue with directions, the organizer's link, add-to-calendar (`.ics` + Google Calendar), share, description, "More in <town>" and "Also on <day>", and newsletter signup.
- Calendar rows, featured cards, and the homepage strip link to these pages instead of leaving the site.
- One schema.org `Event` per page; event pages are in the sitemap.
- Addresses are name + date, stable across rebuilds. A page drops off after its event passes.

**Homepage** (`b4da8e4`, `6e94c8e`)
- "This Week" strip shows 6 events (4 on phones) picked by the tracker's AI Rank, max two per category, instead of the next three by date.
- Featured events within 14 days lead the strip, with the Featured tag, blurb, and highlight.
- Hero: "See what's on this week" button under the signup form.
- Full-width "See all N events" button and quick links (this weekend, categories, top towns) under the strip.

### Earlier
- 2026-09-15: Featured (sponsored) listings on the calendar (`d3ba84d`); daily 09:00 UTC rebuild so the calendar never shows stale days (`ee3fbdf`).
- ~2026-09-01: `/events` calendar with town, category, and weekend landing pages.

## Next up

Ideas worth doing, roughly in priority order. Move items to **Shipped** when done.

- [ ] **Send the newsletter to the calendar.** Each issue links to the full calendar and to on-site event pages instead of organizer sites. The newsletter reaches ~1,930 readers per issue and sends only ~33 site sessions a week, so this is the biggest traffic lever.
- [ ] **Point paid social at the calendar.** If Meta ads are meant to drive site visits, land them on `/events/this-weekend/` rather than the homepage (9s engagement). Ads Manager change, not code.
- [ ] **Default the calendar to the next 7 days** with "Show later events", plus a sticky Today / This weekend / category bar. Today it lists ~200 events over ~44 days (~32,000px on a phone).
- [ ] **Clean event titles at the scraper.** Strip dates embedded in names (e.g. "…, Tuesday, September 22, 2026"). Belongs in the `ledger-events` repo.
- [ ] **Normalize community submissions at build time.** Add `https://` to bare URLs and standardize times (e.g. "1pm" → "1:00 PM") so form submissions never produce broken links.
- [ ] **Keep past event pages** as "this event has passed, here's what's coming up nearby" instead of dropping them, so shared links and search results don't 404.
- [ ] **Featured-listing report for sponsors.** A simple per-event summary (event-page views, add-to-calendar, click-outs) to send after a placement.
- [ ] **Revive the events map** (`/map`, removed in the September refresh; recoverable from git history). Needs a keyless basemap first: CARTO tiles now require an API key.

## How featured listings work

1. In the Event Tracker (Airtable), tick **Featured** and write a one-line **Featured blurb**.
2. The next rebuild (daily, after the Wednesday scrape, or on demand) shows it:
   - highlighted in the calendar list, right away;
   - in the Featured strip at the top of the calendar and leading the homepage "This Week" strip, once the event is within 14 days;
   - with the Featured tag and blurb on its event page.
3. Events added by hand need **AI Decision = Include** (or Source = Tally) to be published, and an **AI Rank** so the weekly ranker doesn't re-score them.
