import { describe, expect, it } from "vitest";
import { challengeCredits, challengeDeltas, eligibleVoters, inviteCode, parseMentions, tallyVotes } from "./social";

describe("mentions", () => {
  it("finds @handles, ignores emails and too-short names", () => {
    expect(parseMentions("@Alex_1 and @bo said hi to @alex_1, mail me a@b.edu, @x")).toEqual(["alex_1"]);
    expect(parseMentions("(@sam) will @priya_walleye969 win?")).toEqual(["sam", "priya_walleye969"]);
    expect(parseMentions("no tags here")).toEqual([]);
  });
});

describe("dispute votes", () => {
  it("only non-trading members other than creator, disputer and tagged can vote", () => {
    expect(eligibleVoters(["a", "b", "c", "d", "e"], ["b"], { creator: "a", disputer: "c", tagged: ["d"] })).toEqual(["e"]);
  });

  it("majority decides at once; plurality at the deadline; ties decide nothing", () => {
    expect(tallyVotes(["1", "1"], 3, false).decided).toBe(1);
    expect(tallyVotes(["1"], 3, false).decided).toBeNull();
    expect(tallyVotes(["1"], 3, true).decided).toBe(1);
    expect(tallyVotes(["void", "void", "0"], 5, true).decided).toBe("void");
    expect(tallyVotes(["0", "1"], 4, true).decided).toBeNull();
    expect(tallyVotes([], 4, true).decided).toBeNull();
  });
});

describe("challenges", () => {
  const c = { challenger_id: "a", opponent_id: "b", challenger_outcome: 0, opponent_outcome: null, stake: 10 };
  const mc = { ...c, challenger_outcome: 0, opponent_outcome: 2 };

  it("pays the winner double, refunds on void or when neither side won", () => {
    expect(challengeCredits(c, 0)).toEqual({ credits: { a: 20 }, winnerId: "a" });
    expect(challengeCredits(c, 1)).toEqual({ credits: { b: 20 }, winnerId: "b" }); // "anything else"
    expect(challengeCredits(c, "void")).toEqual({ credits: { a: 10, b: 10 }, winnerId: null });
    expect(challengeCredits(mc, 2).winnerId).toBe("b");
    expect(challengeCredits(mc, 1)).toEqual({ credits: { a: 10, b: 10 }, winnerId: null }); // neither picked 1
  });

  it("override moves balances by exactly the difference", () => {
    expect(challengeDeltas(c, 0, 1)).toEqual({ a: -20, b: 20 });
    expect(challengeDeltas(c, 1, "void")).toEqual({ a: 10, b: -10 });
    expect(challengeDeltas(c, 0, 0)).toEqual({});
  });
});

it("invite codes are 10 unambiguous characters", () => {
  let x = 0;
  const code = inviteCode(() => (x = (x + 0.37) % 1));
  expect(code).toMatch(/^[a-km-np-z2-9]{10}$/);
});
