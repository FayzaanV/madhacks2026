import "server-only";
import { sharesForProbs } from "@/core/sports";
import { weightedPick } from "@/core/testmarkets";
import { q, tx } from "./ledger";
import { placeBuy, TradeError } from "./markets";

/**
 * Hand-written UW–Madison markets to fill out the board for demos (no Databricks compute). Each opens at a
 * realistic lean (LMSR shares q = b·ln p via sharesForProbs), gets 2–4 small trades from simulated users through
 * the real placeBuy, and is labeled simulated. Idempotent: ids are m-seed-<slug>; existing ones are skipped.
 * Course names start with the category tab keys (CS, Econ, Math, Stat, Chem, Psych) so they land in those tabs.
 */
type Seed = { slug: string; course: string; question: string; probs: number[]; outcomes?: string[]; days: number; source: string };

const B = 300;

export const SEED_MARKETS: Seed[] = [
  // ---- Comp Sci
  { slug: "cs300-mt2-avg", course: "CS 300", question: "Will the CS 300 midterm 2 average be above 75%?", probs: [0.4], days: 9, source: "Canvas grade announcement" },
  { slug: "cs300-project-ext", course: "CS 300", question: "Will the CS 300 final project deadline get extended?", probs: [0.3], days: 20, source: "Course Piazza / Canvas" },
  { slug: "cs400-new-section", course: "CS 400", question: "Will CS 400 add a new lecture section before the spring add deadline?", probs: [0.25], days: 30, source: "Course Search & Enroll" },
  { slug: "cs354-p5-late", course: "CS 354", question: "Will the CS 354 project 5 due date move later?", probs: [0.35], days: 12, source: "Course website" },
  // ---- Econ
  { slug: "econ101-curve", course: "Econ 101", question: "Will Econ 101 curve the second midterm?", probs: [0.6], days: 7, source: "Professor's Canvas announcement" },
  { slug: "econ101-waitlist", course: "Econ 101", question: "Will the Econ 101 spring waitlist clear by the first week of classes?", probs: [0.35], days: 38, source: "Course Search & Enroll" },
  { slug: "econ301-final-format", course: "Econ 301", question: "What format will the Econ 301 final be?", outcomes: ["In person, closed book", "In person, cheat sheet", "Take-home"], probs: [0.45, 0.45, 0.1], days: 14, source: "Syllabus update" },
  // ---- Math
  { slug: "math222-final-last-day", course: "Math 222", question: "Will the Math 222 final be on the last day of finals week?", probs: [0.2], days: 10, source: "Registrar final exam schedule" },
  { slug: "math222-exam3-avg", course: "Math 222", question: "What will the Math 222 exam 3 average be?", outcomes: ["Below 65%", "65–72%", "72–80%", "Above 80%"], probs: [0.2, 0.35, 0.3, 0.15], days: 6, source: "Canvas grade announcement" },
  { slug: "math234-retake", course: "Math 234", question: "Will Math 234 offer an exam retake or replacement policy this semester?", probs: [0.15], days: 25, source: "Course website" },
  // ---- Stats
  { slug: "stat340-fill-hour", course: "Stat 340", question: "Will Stat 340 fill within 1 hour of spring enrollment opening?", probs: [0.85], days: 16, source: "Course Search & Enroll" },
  { slug: "stat240-project-groups", course: "Stat 240", question: "Will Stat 240 allow groups of 4 for the final project?", probs: [0.55], days: 8, source: "Course Canvas" },
  // ---- Chem
  { slug: "chem103-exam3-avg", course: "Chem 103", question: "Will the Chem 103 exam 3 average be above 70%?", probs: [0.45], days: 5, source: "Canvas grade announcement" },
  { slug: "chem103-drop-lowest", course: "Chem 103", question: "Will Chem 103 drop the lowest exam score?", probs: [0.15], days: 22, source: "Syllabus / Canvas" },
  // ---- Psych
  { slug: "psych202-recordings", course: "Psych 202", question: "Will Psych 202 post lecture recordings for the final review session?", probs: [0.7], days: 18, source: "Course Canvas" },
  { slug: "psych202-extra-credit", course: "Psych 202", question: "Will Psych 202 add an extra-credit study option before finals?", probs: [0.5], days: 15, source: "Course Canvas" },
  // ---- Campus
  { slug: "college-library-24-7", course: "campus", question: "Will College Library be open 24/7 during finals week?", probs: [0.75], days: 21, source: "UW Libraries hours page" },
  { slug: "mendota-freeze-jan15", course: "campus", question: "Will Lake Mendota freeze over before January 15?", probs: [0.4], days: 40, source: "Wisconsin State Climatology Office ice record" },
  { slug: "first-inch-snow", course: "campus", question: "When will Madison get its first 1-inch snowfall?", outcomes: ["Before Nov 25", "Nov 25 – Dec 5", "Dec 6 – Dec 15", "After Dec 15"], probs: [0.25, 0.35, 0.25, 0.15], days: 3, source: "National Weather Service, Madison (MSN)" },
  { slug: "gordon-late-night", course: "campus", question: "Will Gordon Dining add late-night hours during finals week?", probs: [0.3], days: 19, source: "University Housing dining hours" },
  { slug: "asm-referendum", course: "campus", question: "Will the next ASM student referendum pass?", probs: [0.55], days: 35, source: "ASM election results" },
  { slug: "metro-route-a", course: "campus", question: "Will Madison Metro add more frequent Route A service by spring semester?", probs: [0.12], days: 39, source: "Madison Metro service announcements" },
  { slug: "housing-lottery-date", course: "campus", question: "Will University Housing announce next year's room selection dates before December?", probs: [0.65], days: 11, source: "University Housing news" },
  { slug: "union-finals-event", course: "campus", question: "Will Memorial Union host a late-night finals study break event?", probs: [0.8], days: 13, source: "Wisconsin Union events calendar" },
  { slug: "bascom-sledding", course: "campus", question: "Will there be enough snow for sledding on Bascom Hill before finals end?", probs: [0.35], days: 26, source: "Campus photos / NWS snow depth" },
];

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Insert the markets that don't exist yet, then add 2–4 small simulated trades to each new one. */
export async function seedMarkets(adminId: string) {
  let created = 0;
  let skipped = 0;
  let trades = 0;
  for (const s of SEED_MARKETS) {
    const labels = s.outcomes ?? ["Yes", "No"];
    const probs = s.outcomes ? s.probs : [s.probs[0], 1 - s.probs[0]];
    const marketId = `m-seed-${s.slug}`;
    const qs = sharesForProbs(probs, B);
    const isNew = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO markets (market_id, school_id, course, question, market_type, status, liquidity_b, creator_id,
                              resolution_source, is_simulated, opens_at, closes_at, category)
         VALUES ($1, 'uw-madison', $2, $3, $4, 'live', $5, $6, $7, true, now(), now() + make_interval(days => $8), 'academic')
         ON CONFLICT (market_id) DO NOTHING RETURNING 1`,
        [marketId, s.course, s.question, s.outcomes ? "multiple_choice" : "binary", B, adminId, s.source, s.days],
      );
      if (!r.rowCount) return false;
      await c.query(
        `INSERT INTO outcomes (market_id, outcome_index, label, q_shares, is_simulated)
         SELECT $1, i - 1, label, q, true FROM unnest($2::text[], $3::float8[]) WITH ORDINALITY AS x(label, q, i)`,
        [marketId, labels, qs],
      );
      return true;
    });
    if (!isNew) {
      skipped++;
      continue;
    }
    created++;
    const n = randInt(2, 4);
    const traders = await q<{ user_id: string }>(
      "SELECT user_id FROM users WHERE is_simulated AND deleted_at IS NULL AND clout >= 20 ORDER BY random() LIMIT $1",
      [n],
    );
    for (const t of traders) {
      try {
        await placeBuy(t.user_id, marketId, weightedPick(probs, Math.random()), randInt(5, 15));
        trades++;
      } catch (e) {
        if (!(e instanceof TradeError)) throw e;
      }
    }
  }
  return { created, skipped, trades };
}
