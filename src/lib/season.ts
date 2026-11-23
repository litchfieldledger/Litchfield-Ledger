// Foliage season runs Sept 1 through Nov 8, judged by the Connecticut date at
// build time, so seasonal links and cards come back on their own every year.
export function foliageSeason(now: Date = new Date()) {
  const nyToday = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [, mm, dd] = nyToday.split('-').map(Number);
  return {
    active: mm === 9 || mm === 10 || (mm === 11 && dd <= 8),
    year: nyToday.slice(0, 4),
  };
}
