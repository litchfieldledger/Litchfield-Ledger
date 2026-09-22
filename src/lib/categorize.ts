// Category for a calendar row, from its title, venue and description.
//
// Titles alone left most of the calendar in "Community": a band's name
// ("Graham Nash", "Puss N Boots") says nothing about music. So the title rules
// go first, then venues that only ever host one kind of thing, then the words
// in the description, then venues that lean one way. Community is what's left.
//
// No imports on purpose, so the rules can be tried against a dump of the live
// calendar under plain Node.

export type Category = 'music' | 'market' | 'art' | 'talk' | 'outdoors' | 'community';

type Rule = [Category, RegExp];

// First match wins, so stage shows ("Parody Musical", "Theatrical Performance")
// are caught before the music words and civic events before everything else.
// The catch-all social words ("Halloween Party", "Fest") come later, after the
// venue rules, so a band's Halloween night at a brewery still reads as music.
const TITLE_RULES: Rule[] = [
  ['community', /\b(town hall meeting|early voting|voting|election|primary|selectmen|board of|hearing|blood drive|trivia|open house|trick-or-treat\w*|hazardous waste)\b/i],
  ['art', /(\blive!?$|\bwhose (line|live)\b)|\b(musical|comedy|comedian|comedic|stand-?up|improv|theatrical|theat(er|re)|play|dance|ballet|puppet\w*)\b/i],
  ['music', /\b(concerts?|music|musicians?|jazz|band|orchestra|quartet|trio|sonata|singers?|songwriters?|songs|choir|chorus|symphony|acoustic|recital|dj|tribute|blues|folk|opera|ceili|bluegrass|beethoven|mozart|bach|pianist|piano|guitar|violin|cello|perform\w*)\b|\bthe [\w' ]+ (story|experience)$/i],
  ['market', /\b(market|farmers?|flea|bazaar|brocante|craft fair|makers|vendors?|tag sale|rummage|swap)\b/i],
  ['outdoors', /\b(hikes?|hiking|walks?|saunters?|trails?|garden|nature|birding|preserve|farm tour|forest|river|paddle|kayak|park|clean-?up|scavenger|wildflowers?|foraging|trout|fishing|peaks?|bike|cycling)\b/i],
  ['art', /\b(art|arts|artists?|artworks?|gallery|exhibit|exhibition|studio|painting|paint|sculpture|photography|pottery|ceramics|clay|film|movie|screening|reception|stitch\w*|sewing|knit\w*|quilt\w*)\b/i],
  ['talk', /\b(talk|author|lecture|reading|book|poetry|discussion|panel|presentation|conversation|workshop|class|seminar|lesson|storytime|history|genealogy|ancestry|library|tour|(book|french|spanish|language|chess) club|medicare)\b/i],
];

const SOCIAL_TITLE: Rule[] = [
  ['community', /\b(meeting|fundraiser|benefit|supper|dinner|breakfast|potluck|festival|fest|fair|celebration|parade|tasting|wine|beer|brewery|bbq|barbecue|oktoberfest|halloween|party)\b/i],
];

// Venues that program one thing, trusted over the description.
const VENUE_RULES: Rule[] = [
  ['music', /\b(infinity music hall|woodbury brewing|music mountain|music shed|race brook lodge)\b/i],
  ['art', /\b(village center for the arts|golden button)\b/i],
];

// Venues that lean one way: used only when the description doesn't settle it.
// The Warner mostly books touring musicians and tribute acts; its comedy and
// improv nights are caught by the title rules above.
const VENUE_LEAN: Rule[] = [
  ['music', /\b(oneglia|warner theat(er|re))\b/i],
  ['art', /\b(stissing center|theat(er|re)|playhouse)\b/i],
];

// Words a description uses for each kind of event. Counted, not first-match:
// one stray "symphony" in a speaker's bio shouldn't make a talk a concert.
const NOTES_WORDS: Rule[] = [
  ['music', /\b(concerts?|live music|musicians?|singer-?songwriter|songwriters?|songs|albums?|band|guitar\w*|vocals?|harmon(y|ies)|tour(ing)? (with|across)|grammy|rock|jazz|blues|folk|bluegrass|funk|soul|hits|setlist|headlin\w*|tribute (show|band|act))\b/gi],
  ['art', /\b(comedian|comedy|stand-?up|improv|musical|theat(er|re)|actors?|cast|stage|exhibit\w*|artists?|artworks?|gallery|paintings?|sculpture|pottery|clay|ceramics?|film|screening)\b/gi],
  ['talk', /\b(talk|lecture|presentation|present(s|ed)?|speakers?|discuss\w*|panel|author|book|learn\w*|workshop|class|session|informative|curator|historian|attorneys?|registration)\b/gi],
  ['outdoors', /\b(hike|hiking|walk|trail|preserve|outdoors?|nature|wildlife|birds?|summit|peaks?|woods|forest)\b/gi],
  ['market', /\b(market|vendors?|shop local|farmers|crafters|artisans)\b/gi],
];

function firstMatch(rules: Rule[], text: string): Category | null {
  if (!text) return null;
  for (const [cat, re] of rules) if (re.test(text)) return cat;
  return null;
}

function fromNotes(notes: string): Category | null {
  if (!notes) return null;
  const text = notes.slice(0, 1200);
  let best: Category | null = null;
  let top = 0;
  let second = 0;
  for (const [cat, re] of NOTES_WORDS) {
    const n = (text.match(re) || []).length;
    if (n > top) {
      second = top;
      top = n;
      best = cat;
    } else if (n > second) {
      second = n;
    }
  }
  // Two mentions, and clearly ahead of the runner-up.
  return top >= 2 && top > second ? best : null;
}

export function categorize(e: { name: string; venue?: string; notes?: string }): Category {
  return (
    firstMatch(TITLE_RULES, e.name) ??
    firstMatch(VENUE_RULES, e.venue || '') ??
    firstMatch(SOCIAL_TITLE, e.name) ??
    fromNotes(e.notes || '') ??
    firstMatch(VENUE_LEAN, e.venue || '') ??
    'community'
  );
}
