(function () {
  const feeds = document.querySelectorAll('[data-beehiiv-feed]');
  const latestPreviews = document.querySelectorAll('[data-beehiiv-latest-preview]');

  if (!feeds.length && !latestPreviews.length) return;
  if (!document.querySelector('.post-empty')) return;

  const MAX_POSTS = 4;

  const stripHtml = (value) => {
    const div = document.createElement('div');
    div.innerHTML = value || '';
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
  };

  const formatDate = (value, withYear) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: withYear ? 'numeric' : undefined,
    });
  };

  const truncateText = (value, maxLength) => {
    if (!value || value.length <= maxLength) return value || '';

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

  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const cleanPreviewText = (value, title) => {
    let text = String(value || '').trim();

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

  // Mirrors smartTitle() in src/lib/beehiiv.ts: ALL-CAPS titles → title case.
  const SMALL_WORDS = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'at', 'by', 'in',
    'of', 'on', 'to', 'up', 'as', 'vs', 'via', 'from', 'with', 'into', 'over', 'per',
  ]);

  const smartTitle = (title) => {
    if (!title || /[a-z]/.test(title)) return title;
    const parts = title.toLowerCase().split(/(\s+)/);
    let wordIndex = 0;
    return parts
      .map((part, i) => {
        if (/^\s*$/.test(part)) return part;
        const prev = parts[i - 2] || '';
        const startsClause = wordIndex === 0 || /[:.?!—–]$/.test(prev);
        wordIndex += 1;
        const bare = part.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        if (!startsClause && SMALL_WORDS.has(bare)) return part;
        return part.replace(/[a-z]/, (c) => c.toUpperCase());
      })
      .join('');
  };

  const readingMinutes = (text) => {
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return Math.max(1, Math.round(words / 230));
  };

  const escapeHtml = (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const renderPosts = (container, posts) => {
    container.innerHTML = posts
      .slice(0, MAX_POSTS)
      .map((post, i) => {
        const image = post.image
          ? `<img src="${escapeHtml(post.image)}" alt="" width="548" height="344" loading="lazy" decoding="async">`
          : '';

        return `
          <li class="journal-card">
            <a href="${escapeHtml(post.url)}" data-track-click="outbound_post_click" data-track-location="post_list">
              <div class="journal-thumb tone-${(i % 4) + 1}">${image}</div>
              <div class="journal-text">
                <h3 class="journal-title">${escapeHtml(post.title)}</h3>
                <p class="journal-meta">${escapeHtml(post.dateShort)}<span class="dot">•</span>${post.readMinutes} min read</p>
              </div>
            </a>
          </li>
        `;
      })
      .join('');
  };

  const renderLatestPreview = (container, post) => {
    const kicker = container.querySelector('.latest-issue-kicker');
    const title = container.querySelector('.latest-issue-title');
    const deck = container.querySelector('.latest-issue-deck');
    const preview = container.querySelector('.latest-issue-preview');

    if (!kicker || !title || !preview) return;

    kicker.innerHTML = `<span>The Tuesday Letter</span><span>${escapeHtml(post.date)}</span>`;

    if (title.tagName.toLowerCase() === 'a') {
      title.href = post.url;
      title.textContent = post.title;
    } else {
      const link = document.createElement('a');
      link.href = post.url;
      link.className = title.className;
      link.id = title.id;
      link.textContent = post.title;
      link.dataset.trackClick = 'outbound_post_click';
      link.dataset.trackLocation = 'latest_issue';
      title.replaceWith(link);
    }

    if (deck) {
      if (post.excerpt && post.excerpt !== post.preview) {
        deck.textContent = post.excerpt;
      } else {
        deck.remove();
      }
    } else if (post.excerpt && post.excerpt !== post.preview && preview) {
      const deckEl = document.createElement('p');
      deckEl.className = 'latest-issue-deck';
      deckEl.textContent = post.excerpt;
      preview.before(deckEl);
    }

    preview.innerHTML = post.preview ? `<p>${escapeHtml(post.preview)}</p>` : '';
    container.classList.remove('latest-issue-empty');
  };

  // Beehiiv RSS links point at the beehiiv.com copy; we host the same post
  // at /p/<slug>/ so keep readers (and crawlers) on this domain.
  const toLocalUrl = (url) => {
    const m = String(url || '').match(/\/p\/([^/?#]+)/);
    return m ? `/p/${m[1]}/` : url;
  };

  const getText = (item, selector) =>
    item.querySelector(selector)?.textContent?.trim() || '';

  const getContentText = (item) =>
    item.querySelector('content\\:encoded')?.textContent?.trim() ||
    item.getElementsByTagName('content:encoded')[0]?.textContent?.trim() ||
    '';

  // Post image: RSS enclosure / media:* first, then the first <img> in the body.
  const getImage = (item, contentHtml) => {
    const enclosure = item.querySelector('enclosure');
    if (enclosure?.getAttribute('url')) return enclosure.getAttribute('url');

    const media =
      item.getElementsByTagName('media:content')[0] ||
      item.getElementsByTagName('media:thumbnail')[0];
    if (media?.getAttribute('url')) return media.getAttribute('url');

    const match = String(contentHtml || '').match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : '';
  };

  const loadFeed = () => {
    fetch('/feed')
      .then((response) => {
        if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
        return response.text();
      })
      .then((xml) => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const items = Array.from(doc.querySelectorAll('item')).slice(0, MAX_POSTS);

        const posts = items
          .map((item) => {
            const rawTitle = stripHtml(getText(item, 'title'));
            const title = smartTitle(rawTitle);
            const url = toLocalUrl(getText(item, 'link'));
            const pubDate = getText(item, 'pubDate');
            const contentHtml = getContentText(item);
            const contentText = stripHtml(contentHtml || getText(item, 'description'));
            const excerpt = stripHtml(getText(item, 'description'));
            const preview = truncateText(cleanPreviewText(contentText, rawTitle), 1000);

            return {
              title,
              url,
              date: formatDate(pubDate, true),
              dateShort: formatDate(pubDate, false).toUpperCase(),
              excerpt,
              preview,
              image: getImage(item, contentHtml),
              readMinutes: readingMinutes(contentText),
            };
          })
          .filter((post) => post.title && post.url);

        if (!posts.length) return;

        feeds.forEach((feed) => renderPosts(feed, posts));
        latestPreviews.forEach((preview) => renderLatestPreview(preview, posts[0]));
      })
      .catch((error) => {
        console.warn('Beehiiv feed refresh failed:', error);
      });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(loadFeed);
  } else {
    window.setTimeout(loadFeed, 1500);
  }
})();
