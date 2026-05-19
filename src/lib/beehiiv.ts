const PUBLICATION_ID = import.meta.env.BEEHIIV_PUBLICATION_ID;
const API_KEY = import.meta.env.BEEHIIV_API_KEY;
const POST_LIMIT = 5;

export type LedgerPost = {
  title: string;
  excerpt: string;
  url: string;
  date: string;
};

export async function getLedgerPosts(): Promise<LedgerPost[]> {
  if (!PUBLICATION_ID || !API_KEY) {
    console.warn('Missing Beehiiv env vars.');
    return [];
  }

  try {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/posts` +
        `?limit=${POST_LIMIT}` +
        `&status=confirmed` +
        `&order_by=publish_date` +
        `&direction=desc` +
        `&platform=both` +
        `&hidden_from_feed=false`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!res.ok) {
      console.error('Beehiiv posts fetch failed:', res.status, await res.text());
      return [];
    }

    const json = await res.json();

    return (json.data ?? []).map((p: any) => ({
      title: p.title ?? '',
      excerpt: (p.subtitle || p.preview_text || '').trim(),
      url: p.web_url ?? '#',
      date: new Date((p.publish_date ?? 0) * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    }));
  } catch (err) {
    console.error('Beehiiv posts fetch error:', err);
    return [];
  }
}
