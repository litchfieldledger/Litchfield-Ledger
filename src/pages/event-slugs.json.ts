// Record id → event page address, read by ledger-events' persist_slugs.py to
// save each address into the tracker once, so it never moves.
import type { APIRoute } from 'astro';
import { getSlugManifest } from '../lib/events';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await getSlugManifest()), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
