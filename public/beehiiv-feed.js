(function () {
  const feeds = document.querySelectorAll('[data-beehiiv-feed]');

  if (!feeds.length) return;
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
          ? `<div class="post-excerpt">${escapeHtml(post.excerpt)}</div>`
          : '';

        return `
          <li class="post-item">
            <a href="${escapeHtml(post.url)}" class="post-link">
              <div class="post-meta">${escapeHtml(post.date)}</div>
              <div class="post-title">${escapeHtml(post.title)}</div>
              ${excerpt}
            </a>
          </li>
        `;
      })
      .join('');
  };

  const getText = (item, selector) =>
    item.querySelector(selector)?.textContent?.trim() || '';

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
            const excerpt = stripHtml(
              getText(item, 'description') || getText(item, 'encoded')
            );

            return { title, url, date, excerpt };
          })
          .filter((post) => post.title && post.url);

        if (!posts.length) return;

        feeds.forEach((feed) => renderPosts(feed, posts));
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
