(function () {
  const feeds = document.querySelectorAll('[data-beehiiv-feed]');
  const latestPreviews = document.querySelectorAll('[data-beehiiv-latest-preview]');

  if (!feeds.length && !latestPreviews.length) return;
  if (!document.querySelector('.post-empty')) return;

  const stripHtml = (value) => {
    const div = document.createElement('div');
    div.innerHTML = value || '';
    return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
  };

  const formatDate = (value) => {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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

  const escapeHtml = (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const renderPosts = (container, posts) => {
    container.innerHTML = posts
      .map((post) => {
        const excerpt = post.excerpt
          ? `<div class="post-excerpt">${escapeHtml(truncateText(post.excerpt, 180))}</div>`
          : '';

        return `
          <li class="post-item">
            <a href="${escapeHtml(post.url)}" class="post-link" data-track-click="outbound_post_click" data-track-location="post_list">
              <div class="post-meta">${escapeHtml(post.date)}</div>
              <div class="post-title">${escapeHtml(post.title)}</div>
              ${excerpt}
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

    kicker.innerHTML = `<span>This Week</span><span>${escapeHtml(post.date)}</span>`;

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

  const getText = (item, selector) =>
    item.querySelector(selector)?.textContent?.trim() || '';

  const getContentText = (item) =>
    item.querySelector('content\\:encoded')?.textContent?.trim() ||
    item.getElementsByTagName('content:encoded')[0]?.textContent?.trim() ||
    '';

  const loadFeed = () => {
    fetch('/feed')
      .then((response) => {
        if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
        return response.text();
      })
      .then((xml) => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const items = Array.from(doc.querySelectorAll('item')).slice(0, 5);

        const posts = items
          .map((item) => {
            const title = stripHtml(getText(item, 'title'));
            const url = getText(item, 'link');
            const date = formatDate(getText(item, 'pubDate'));
            const excerpt = stripHtml(getText(item, 'description'));
            const preview = truncateText(
              cleanPreviewText(
                stripHtml(getContentText(item) || getText(item, 'description')),
                title
              ),
              1000
            );

            return { title, url, date, excerpt, preview };
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
