// Titles shown next to your name. Earned from your Clout tier (here) and from gold flair (gold.user_flair);
// you pick which one to display on /me.

export const TIER_TITLES = [
  { min: 0, title: "Trader" },
  { min: 250, title: "Market Maker" },
  { min: 500, title: "Resolver" },
  { min: 1000, title: "Moderator" },
] as const;

export const IN_THE_RED = "In the Red";

/** Tier titles you hold at this true Clout, lowest first. Below 0 you only get "In the Red". */
export function tierTitles(clout: number): string[] {
  if (clout < 0) return [IN_THE_RED];
  return TIER_TITLES.filter((t) => clout >= t.min).map((t) => t.title);
}

/** Everything you can display: tier titles plus flair earned in gold. */
export const earnedTitles = (clout: number, flair: readonly string[]) => [...tierTitles(clout), ...flair];

/** What to show: your chosen title if you still hold it, otherwise your highest tier title. */
export function displayTitle(chosen: string | null | undefined, clout: number, flair: readonly string[] = []): string {
  const earned = earnedTitles(clout, flair);
  return chosen && earned.includes(chosen) ? chosen : earned[tierTitles(clout).length - 1];
}
