const PUBLICATION_ID = import.meta.env.BEEHIIV_PUBLICATION_ID;
const API_KEY = import.meta.env.BEEHIIV_API_KEY;
const POST_LIMIT = 5;

export type LedgerPost = {
  title: string;
  excerpt: string;
  preview: string;
  url: string;
  date: string;
};

export type LedgerStats = {
  activeSubscribers: number;
  joinedThisWeek: number;
};

// Pulls the total active subscriber count and the number of active
// subscribers created in the last 7 days. Runs at build time, so the
// figures are accurate as of the most recent deploy.
export async function getLedgerStats(): Promise<LedgerStats | null> {
  if (!PUBLICATION_ID || !API_KEY) {
    console.warn('Missing Beehiiv env vars.');
    return null;
  }

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
  };

  let activeSubscribers = 0;
  try {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}?expand=stats`,
      { headers }
    );
    if (res.ok) {
      const json = await res.json();
      activeSubscribers = json.data?.stats?.active_subscriptions ?? 0;
    } else {
      console.error('Beehiiv stats fetch failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Beehiiv stats fetch error:', err);
  }

  // Count active subscriptions created within the last 7 days by walking the
  // list newest-first and stopping once we pass the cutoff.
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  let joinedThisWeek = 0;
  try {
    for (let page = 1; page <= 20; page += 1) {
      const params = new URLSearchParams({
        limit: '100',
        status: 'active',
        order_by: 'created',
        direction: 'desc',
        page: String(page),
      });

      const res = await fetch(
        `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions?${params}`,
        { headers }
      );

      if (!res.ok) {
        console.error('Beehiiv subscriptions fetch failed:', res.status, await res.text());
        break;
      }

      const json = await res.json();
      const subs: any[] = json.data ?? [];
      if (subs.length === 0) break;

      let passedCutoff = false;
      for (const sub of subs) {
        if ((sub.created ?? 0) >= cutoff) joinedThisWeek += 1;
        else {
          passedCutoff = true;
          break;
        }
      }

      if (passedCutoff || subs.length < 100) break;
    }
  } catch (err) {
    console.error('Beehiiv subscriptions fetch error:', err);
  }

  return { activeSubscribers, joinedThisWeek };
}

const stripHtml = (value: string) =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const truncateText = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;

  const clipped = value.slice(0, maxLength);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('? '),
    clipped.lastIndexOf('! ')
  );

  if (sentenceEnd > maxLength * 0.55) return clipped.slice(0, sentenceEnd + 1);

  const wordEnd = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, wordEnd > 0 ? wordEnd : maxLength).trim()}...`;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanPreviewText = (value: string, title: string) => {
  let text = value.trim();

  if (!text) return '';

  const knownBodyStart = text.search(/now that we've completed/i);
  if (knownBodyStart > -1 && knownBodyStart < 600) {
    text = text.slice(knownBodyStart);
  }

  const titlePattern = title ? new RegExp(`^${escapeRegExp(title)}\\s*`, 'i') : null;
  const datePattern =
    /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\s*/i;
  const newsletterPattern = /^the\s+tuesday\s+letter\s*:\s*[^.?!]*?(?:edition)?\s*/i;

  for (let i = 0; i < 4; i += 1) {
    const before = text;
    if (titlePattern) text = text.replace(titlePattern, '');
    text = text.replace(datePattern, '');
    text = text.replace(newsletterPattern, '');
    text = text.trim();
    if (text === before) break;
  }

  return text;
};

const contentValue = (post: any) =>
  post.content?.free?.web ||
  post.content?.free?.rss ||
  post.content?.premium?.web ||
  post.content?.premium?.rss ||
  post.content?.web ||
  post.content?.rss ||
  '';

export async function getLedgerPosts(): Promise<LedgerPost[]> {
  if (!PUBLICATION_ID || !API_KEY) {
    console.warn('Missing Beehiiv env vars.');
    return [];
  }

  try {
    const params = new URLSearchParams({
      limit: String(POST_LIMIT),
      status: 'confirmed',
      order_by: 'publish_date',
      direction: 'desc',
      platform: 'both',
      hidden_from_feed: 'false',
    });
    params.append('expand', 'free_web_content');
    params.append('expand', 'free_rss_content');

    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/posts?${params}`,
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

    return (json.data ?? []).map((p: any) => {
      const title = p.title ?? '';
      const excerpt = (p.subtitle || p.preview_text || '').trim();
      const contentPreview = cleanPreviewText(stripHtml(contentValue(p)), title);

      return {
        title,
        excerpt,
        preview: truncateText(contentPreview || excerpt, 1000),
        url: p.web_url ?? '#',
        date: new Date((p.publish_date ?? 0) * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };
    });
  } catch (err) {
    console.error('Beehiiv posts fetch error:', err);
    return [];
  }
}
