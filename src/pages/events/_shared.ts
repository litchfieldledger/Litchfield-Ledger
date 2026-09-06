// Shared bits for the /events pages.
export const SUBMIT_URL = 'https://litchfieldledger.beehiiv.com/add-your-event';
export const SITE = 'https://litchfieldledger.com';

export const breadcrumbs = (items: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: it.path === '/' ? `${SITE}/` : `${SITE}${it.path}/`,
  })),
});
