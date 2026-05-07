// Synthetic news feed used by /api/news on public demo deployments
// (when KINBOARD_DEMO_FAMILY_CODE is set on the server). All content
// here is fictional — no real publisher, no real journalist, no
// copyrighted material. The point is to render the news widget with
// believable headlines so visitors can see the feature working,
// without re-displaying real RSS feeds (which puts a public demo
// in a copyright grey zone — see docs/wiki/Self-hosting.md).
//
// Self-hosters running their own household never see this — their
// /api/news fetches real RSS feeds as before.

export interface DemoNewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  image?: string;
  source: string;
  sourceName: string;
  category?: string;
  /** Body text for the reader-mode endpoint. Multiple paragraphs. */
  body: string[];
}

// pubDate offsets are computed at request time so the feed always
// looks fresh. Hours-ago array indexes match the items below.
const HOURS_AGO = [2, 6, 11, 18, 26, 38, 50, 62, 78, 96];

const ARTICLES: Omit<DemoNewsItem, "pubDate">[] = [
  {
    title: "Why batch-cooking on Sunday saves more than just time",
    link: "https://demo.kinboard.app/demo-news/batch-cooking",
    description:
      "A quiet two hours on Sunday afternoon turns into five calmer weeknight dinners. We tested the math on time, money, and stress — the savings compound.",
    image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800",
    source: "demo-family-living",
    sourceName: "Family Living",
    category: "Food",
    body: [
      "Batch-cooking gets recommended so often it has become background noise. We wanted to know whether the actual numbers hold up — so for two months a household of four logged exactly how much time, money, and packaging waste landed in their kitchen.",
      "The biggest surprise was not how much time was saved, but how much *decision* was eliminated. The Tuesday-evening question of \"what's for dinner?\" disappeared. The household reported sleeping ten minutes earlier on average across the test period.",
      "Money-wise, weekly grocery spend dropped about 15% — mostly because the meal plan made the shopping list, and an actual list cuts impulse buys. Packaging waste dropped further: bulk-buying staples and reusing containers from one week to the next reduced single-use plastic in the bin by roughly a third.",
      "The pattern that worked best was a two-hour Sunday window with one batch of grain, one batch of protein, two sauces, and roasted vegetables. Mix and match across five weeknights with minimal extra cooking. Lazy parents called it \"adult Lego.\"",
    ],
  },
  {
    title: "The quiet rise of family hobby nights",
    link: "https://demo.kinboard.app/demo-news/hobby-nights",
    description:
      "One evening a week, no screens, everyone picks something to do at the same table. Turns out the kids remember the activity less than the proximity.",
    image: "https://images.unsplash.com/photo-1529390079861-591de354faf5?w=800",
    source: "demo-family-living",
    sourceName: "Family Living",
    category: "Lifestyle",
    body: [
      "It started in March as a desperate move against the screen-and-scroll evening loop. By summer, the families running it told us they had started looking forward to Wednesdays.",
      "The format is deliberately unglamorous: 90 minutes, one shared table, everyone brings something they want to do — knitting, lego, watercolor, model trains. No phones. Conversation happens or doesn't. The point is presence, not performance.",
      "The most-cited observation was that kids stopped asking what other kids were doing on social media — because they were doing the thing in the room. Several parents reported their teenagers initiating the night by week six.",
      "Skeptical? The hardest part is the first three weeks. After that the routine builds its own momentum.",
    ],
  },
  {
    title: "Heat pumps: what the latest cold-climate field data actually shows",
    link: "https://demo.kinboard.app/demo-news/heat-pumps",
    description:
      "Two heating seasons of monitored installs in temperate Europe. The headline: modern units kept up far below the temperatures earlier generations stalled at.",
    image: "https://images.unsplash.com/photo-1565793298595-6a879b1d9492?w=800",
    source: "demo-tech-ledger",
    sourceName: "The Tech Ledger",
    category: "Energy",
    body: [
      "A multi-month study tracked 600 heat-pump installs across mid-Europe through two heating seasons. The cleanest finding: the new generation of cold-climate units delivered useful heat down to -22°C without needing the resistive backup that older models relied on.",
      "Coefficient of performance (COP) — the ratio of heat output to electricity input — averaged 3.4 across the cohort. The worst-performing 10% averaged 2.6, still substantially better than gas.",
      "The cohort that retrofitted radiators to slightly oversized models had noticeably better real-world numbers than the cohort that kept original radiators. The lesson: heat pumps benefit from low-temperature emitters more than from any other single optimization.",
      "Cost-per-kWh of useful heat, after factoring in current European electricity prices, came in below comparable gas service for 78% of the installs.",
    ],
  },
  {
    title: "Why your sourdough crust isn't crackling (and the 30-second fix)",
    link: "https://demo.kinboard.app/demo-news/sourdough-crust",
    description:
      "It is almost never the recipe. It is almost always the steam — and the home-oven steam most people add doesn't do what they think it does.",
    image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800",
    source: "demo-kitchen-table",
    sourceName: "Kitchen Table",
    category: "Food",
    body: [
      "If your sourdough comes out tasting fine but with a dull, leathery crust instead of the shattering one bakeries produce, the recipe is rarely the problem. Steam in the first ten minutes of baking is — and the home-oven hacks most people use don't deliver enough of it.",
      "The fix that actually works: bake under a heavy preheated lid for the first 20 minutes. A cast-iron Dutch oven works. So does a deep stainless-steel hotel pan inverted over a pizza stone. The lid traps the moisture the dough itself releases — far more than a tray of ice cubes ever provides.",
      "Remove the lid for the second half of the bake to color the crust. The contrast between the steamy first phase and the dry second phase is what produces the bakery-style crackle.",
      "If you only change one thing, change this. It is the closest thing to a free upgrade home-baking has.",
    ],
  },
  {
    title: "School chaperone tips from people who have actually done it",
    link: "https://demo.kinboard.app/demo-news/chaperone-tips",
    description:
      "Volunteered for a class trip? Here is what the parents who keep getting asked back actually do — short version: less hovering, more counting.",
    image: "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800",
    source: "demo-family-living",
    sourceName: "Family Living",
    category: "Education",
    body: [
      "The parents teachers ask back twice are not the most charismatic ones — they are the ones who count children silently, every time the group transitions, without making it weird.",
      "Three habits that show up across the dependable cohort: (1) memorize the four kids assigned to you on sight before leaving the school; (2) hang at the back of the group, not the front, so you can see everyone; (3) carry one pack of tissues, one charger, and a sandwich nobody asked for.",
      "Avoid: phone calls during the trip, conspicuous photo-taking of other people's children, and being the parent who says yes to ice cream when the teacher said no.",
      "If your child is in the group, treat them like any other child. Singling them out is the most-cited reason teachers don't reinvite a parent.",
    ],
  },
  {
    title: "The one chore your dishwasher does badly (and how to know)",
    link: "https://demo.kinboard.app/demo-news/dishwasher-chore",
    description:
      "Modern dishwashers are remarkable, but one specific category of dish comes out worse than hand-washing — every time. Hint: it's not the wine glasses.",
    image: "https://images.unsplash.com/photo-1556909226-c01a8b3c2ec5?w=800",
    source: "demo-kitchen-table",
    sourceName: "Kitchen Table",
    category: "Home",
    body: [
      "Dishwashers are now better at glassware than most home cooks. They are not better at sharp knives — and the gap costs money over a kitchen's lifetime.",
      "The problem is not the heat or the detergent. It is the random impacts: knives bouncing against the basket, edges nicking other utensils, microscopic chips that dull the blade much faster than cutting ever does.",
      "Test it: hand-wash one chef's knife for a year and dishwasher-wash an identical one. Most kitchens will retire the dishwasher knife in 2-3 years. Hand-washed equivalents routinely run 15+.",
      "If you only hand-wash one category of dish in your kitchen, make it the knives. Everything else is fine.",
    ],
  },
  {
    title: "Indoor plants that will not punish you for forgetting once",
    link: "https://demo.kinboard.app/demo-news/forgiving-plants",
    description:
      "Five varieties that survive a missed watering, low light, and the occasional toddler attack. None of them are succulents.",
    image: "https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=800",
    source: "demo-greenhouse-quarterly",
    sourceName: "Greenhouse Quarterly",
    category: "Home",
    body: [
      "If you've killed a succulent — and most of us have — the issue isn't your green thumb. It's that succulents are unforgiving in the exact way busy households need plants to forgive.",
      "Five varieties that survive everything from a missed week of watering to a toddler attack: ZZ plant, snake plant, pothos, philodendron heartleaf, cast-iron plant. All five tolerate low light, and all five will recover from neglect that would kill anything in the cactus family.",
      "The ZZ plant in particular has a near-mythic ability to bounce back. Households tracking these reported they could miss four consecutive weeks of watering and the plant would shrug it off.",
      "If you have one window with terrible light and a busy life, start there. Aspirational gardening kills more plants than aspirational watering schedules.",
    ],
  },
  {
    title: "Cold-water swimming, four months in: what changed",
    link: "https://demo.kinboard.app/demo-news/cold-water-swimming",
    description:
      "The hype said euphoria, immune boost, transformation. The reality is more modest — but the sleep difference is real.",
    image: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=800",
    source: "demo-tech-ledger",
    sourceName: "The Tech Ledger",
    category: "Health",
    body: [
      "Cold-water swimming has graduated from fringe to influencer. We followed a cohort of 50 people who started a structured program (3 swims a week, 8 weeks) and tracked sleep, mood, and resting heart rate.",
      "What didn't change: subjective \"energy\" or weight. The transformation narrative didn't show up in the data.",
      "What did change: average sleep latency dropped from 22 minutes to 11. Resting heart rate fell by 4 bpm. Mood scores improved modestly but consistently.",
      "The honest summary: cold-water swimming is not a panacea, but for sleep specifically, it appears to be one of the more reliable lifestyle interventions in the literature. Three weekly swims of 5–8 minutes seems to be the floor for measurable effect.",
    ],
  },
  {
    title: "The case for monthly photo albums (and against the cloud-only approach)",
    link: "https://demo.kinboard.app/demo-news/photo-albums",
    description:
      "Twenty thousand phone photos in the cloud is not an archive. It's a pile. Here's the simplest curation routine that survives years of busy life.",
    image: "https://images.unsplash.com/photo-1452830978618-d6feae7d0ffa?w=800",
    source: "demo-family-living",
    sourceName: "Family Living",
    category: "Lifestyle",
    body: [
      "Most families now have between 5,000 and 30,000 phone photos in cloud storage. Almost none are organized. When a grandparent dies, when a child finishes school, when an anniversary lands — the search through that pile is brutal.",
      "The lightweight routine that survives life is: once a month, on the same evening, open last month's camera roll and pick 12 photos. Move them to an album titled YYYY-MM. That's it. Don't curate. Don't try to find the best ones. Just twelve.",
      "After two years you have an album that fits on a tablet, narrates the whole period, and can be printed for grandparents in an afternoon.",
      "The reason the routine works is that it sets the bar low. \"Find 12 photos\" is a 6-minute task. \"Organize 5,000 photos\" is a project no busy family ever finishes.",
    ],
  },
  {
    title: "Why your weeknight dinners take longer than they used to",
    link: "https://demo.kinboard.app/demo-news/weeknight-dinners",
    description:
      "It's almost never the cooking. It's the standing-in-front-of-the-fridge phase before cooking starts. Here's how the pros invisibilize it.",
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800",
    source: "demo-kitchen-table",
    sourceName: "Kitchen Table",
    category: "Food",
    body: [
      "If a 20-minute weeknight dinner now takes you 45 minutes, the bottleneck is almost certainly not the cooking. It's the moment between walking through the door and starting to cook — the staring-at-the-fridge phase.",
      "Restaurants invisibilize this with mise en place: every ingredient is portioned, prepped, and laid out before the line opens. Home cooks rarely do this, and the cost is silent — but it adds up to the difference between fast weeknight cooking and slow weeknight cooking.",
      "The home-cook version doesn't require Sunday meal prep. It just requires: when you put the groceries away, take 90 seconds to sort them by tonight's dinner — chop the onion, drain the can, defrost the meat. Future-you, at 6:30pm, will thank current-you.",
      "Test it for one week. The pattern that emerges is striking: the cooking time stays the same, but the perceived time drops by half because the cognitive load of \"what was I going to make again?\" disappears.",
    ],
  },
];

export function getDemoNewsItems(): DemoNewsItem[] {
  const now = Date.now();
  return ARTICLES.map((a, i) => ({
    ...a,
    pubDate: new Date(now - HOURS_AGO[i] * 60 * 60 * 1000).toISOString(),
  }));
}

export function findDemoArticle(url: string): DemoNewsItem | null {
  return getDemoNewsItems().find((a) => a.link === url) ?? null;
}

export function isDemoMode(): boolean {
  return Boolean(process.env.KINBOARD_DEMO_FAMILY_CODE?.trim());
}
