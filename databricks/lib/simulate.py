"""Simulated campus data for The Curve. Pure Python (stdlib + clout.py), deterministic by seed.

simulate() returns dict[table_name -> list[dict]] matching the bronze schemas:
users_raw, markets_raw, outcomes_raw, trades_raw, resolutions_raw, comments_raw, disputes_raw.
Every row has is_simulated=True. The demo market (DEMO_MARKET_ID) is tuned to show
~35% crowd price vs ~60% Smart Money on YES.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

import clout as c

SCHOOL = "uw-madison"
DEMO_MARKET_ID = "m-demo-econ301-waitlist"
NOW = datetime(2026, 11, 14, 18, 0, tzinfo=timezone.utc)
TERM_START = datetime(2026, 8, 20, tzinfo=timezone.utc)

ARCHETYPES = [  # name, share, belief noise, activity weight
    ("good", 0.15, 0.06, 1.6),
    ("casual", 0.20, 0.15, 0.8),
    ("bad", 0.25, 0.28, 1.0),
    ("herd", 0.30, None, 1.2),
    ("troll", 0.10, None, 0.7),
]
MAJORS = ["Computer Sciences", "Economics", "Statistics", "Data Science", "Mathematics", "Biology",
          "Psychology", "Political Science", "Mechanical Engineering", "Journalism", "Finance", "Chemistry"]
DORMS = ["Sellery", "Witte", "Ogg", "Dejope", "Chadbourne", "Smith", "Leopold", "Kronshage",
         "Adams", "Tripp", "Waters", "Off campus"]
CLUBS = ["Badger Hackers", "Wisconsin Union Directorate", "Badger Quidditch", "Data Science Club",
         "Investment Club", "Mock Trial", "Hoofers", "ASM", "none"]
FIRST = ["alex", "sam", "jordan", "taylor", "maya", "noah", "priya", "liam", "ava", "omar", "zoe",
         "eli", "sofia", "ben", "nina", "kai", "lena", "raj", "chloe", "max", "ivy", "leo", "aria", "finn"]
ANIMALS = ["badger", "otter", "heron", "walleye", "loon", "crane", "fox", "owl", "bison", "elk"]

BINARY_TEMPLATES = [
    ("Econ 301", "Will the Econ 301 waitlist clear before the first day of class?"),
    ("CS 400", "Will a new section of CS 400 be added this semester?"),
    ("Stat 340", "Will Stat 340 fill within 1 hour of enrollment opening?"),
    ("Math 222", "Will the Math 222 midterm 1 average be above 75?"),
    ("Chem 103", "Will the Chem 103 exam 2 average be above 70?"),
    ("CS 354", "Will CS 354 project 3 deadline get extended?"),
    ("Psych 202", "Will Psych 202 midterm 2 average be above 80?"),
    ("Econ 101", "Will Econ 101 add a review session before the final?"),
    ("CS 300", "Will the CS 300 P05 autograder go down the night before the deadline?"),
    ("Stat 240", "Will Stat 240 curve the midterm?"),
    ("Comp Sci 540", "Will CS 540 release homework 4 late?"),
    ("Math 340", "Will the Math 340 final be cumulative?"),
    ("campus", "Will the Badgers beat Iowa this weekend?"),
    ("campus", "Will UW cancel classes for snow before Thanksgiving?"),
    ("campus", "Will turnout in the ASM fall election exceed 15%?"),
    ("campus", "Will the Union Terrace chairs come back out before Dec 1?"),
    ("campus", "Will Badger men's hockey sweep this weekend's series?"),
    ("campus", "Will the Kohl Center sell out for the Marquette game?"),
    ("Econ 302", "Will Econ 302 waitlist clear by the end of week 2?"),
    ("CS 577", "Will CS 577 exam 2 average be above 65?"),
    ("Biology 151", "Will Bio 151 lab reports be moved online?"),
    ("Finance 300", "Will Finance 300 midterm average be above 78?"),
    ("Stat 340", "Will Stat 340 add a second TA office hour block?"),
    ("CS 400", "Will CS 400 drop the lowest quiz score?"),
    ("Math 234", "Will Math 234 exam 2 average be above 70?"),
    ("Data Sci 100", "Will Data Sci 100 enrollment exceed 600 next fall?"),
    ("campus", "Will Bascom Hill get its first snow before Nov 20?"),
    ("campus", "Will the Badgers make a bowl game?"),
    ("Econ 310", "Will Econ 310 problem set 5 be optional?"),
    ("Psych 210", "Will Psych 210 waitlist clear before the drop deadline?"),
    ("Chem 104", "Will Chem 104 add a Saturday exam review?"),
    ("CS 252", "Will CS 252 midterm average be above 80?"),
    ("Journalism 202", "Will J202 move the final project due date?"),
    ("Poli Sci 104", "Will Poli Sci 104 have a pop quiz this week?"),
    ("campus", "Will the Rathskeller extend hours during finals?"),
    ("CS 640", "Will CS 640 midterm be take-home?"),
    ("ME 340", "Will ME 340 lab 4 be cancelled?"),
    ("Stat 333", "Will Stat 333 final be open-note?"),
]
MULTI_TEMPLATES = [
    ("Math 222", "What will the Math 222 final average be?", ["Below 65", "65-75", "75-85", "Above 85"]),
    ("CS 400", "How many seats will open in CS 400 after the drop deadline?", ["0-5", "6-15", "16-30", "31+"]),
    ("campus", "Who wins the ASM chair race?", ["Candidate A", "Candidate B", "Candidate C"]),
    ("Econ 301", "How many Econ 301 waitlisted students get in?", ["Under 10", "10-25", "26-50", "50+"]),
    ("campus", "Badgers vs Minnesota margin of victory?", ["Lose", "Win by 1-7", "Win by 8-14", "Win by 15+"]),
    ("Stat 340", "Stat 340 project 2 median score?", ["Below 80", "80-89", "90-95", "96+"]),
    ("Chem 103", "Chem 103 final exam date gets moved to?", ["Stays put", "Earlier", "Later"]),
    ("campus", "Inches of snow in Madison by Dec 1?", ["0-2", "3-6", "7-12", "13+"]),
    ("CS 354", "CS 354 midterm 2 average?", ["Below 60", "60-70", "70-80", "80+"]),
    ("campus", "Kohl Center attendance for Marquette game?", ["Under 14k", "14-16k", "16-17k", "Sellout"]),
    ("Econ 101", "Econ 101 midterm 2 average?", ["Below 70", "70-75", "75-80", "80+"]),
    ("campus", "Which dining hall wins the fall food fight poll?", ["Gordon", "Four Lakes", "Liz Waters", "Rheta's"]),
]
COMMENT_TEMPLATES = [
    "{p}% feels way too {dir} to me.", "Prof basically confirmed this in lecture lol",
    "Last year this happened in week 3, just saying.", "Fading the Hall of Shame on this one.",
    "Smart money is on the other side, be careful.", "Resolution source looks solid.",
    "TA said something in discussion that makes me think it's {side}.", "Free Clout if you read the syllabus.",
    "This market is going to swing hard after the drop deadline.", "Herd is wrong again.",
    "Bought the dip.", "Holding my position until the announcement.",
]


def _clip(x, lo=0.02, hi=0.98):
    return max(lo, min(hi, x))


def simulate(seed: int = 42, n_users: int = 2000, n_trades: int = 20000, b: float = c.DEFAULT_B):
    rng = random.Random(seed)

    # -------------------------------------------------------------- users
    users = []
    types = [a[0] for a in ARCHETYPES]
    shares = [a[1] for a in ARCHETYPES]
    for k in range(n_users):
        arch = rng.choices(types, shares)[0]
        users.append({
            "user_id": f"sim-u{k:04d}",
            "school_id": SCHOOL,
            "handle": f"{rng.choice(FIRST)}_{rng.choice(ANIMALS)}{rng.randint(1, 999)}",
            "email": f"sim-u{k:04d}@sim.wisc.edu",
            "major": rng.choice(MAJORS),
            "dorm": rng.choice(DORMS),
            "club": rng.choice(CLUBS),
            "class_year": rng.choice([2027, 2028, 2029, 2030]),
            "archetype": arch,
            "is_instructor": False,
            "clout": 0.0,
            "created_at": TERM_START + timedelta(hours=rng.uniform(0, 72)),
        })
    arch_of = {u["user_id"]: u["archetype"] for u in users}
    noise = {a[0]: a[2] for a in ARCHETYPES}
    activity = [dict((a[0], a[3]) for a in ARCHETYPES)[u["archetype"]] * rng.uniform(0.3, 1.7) for u in users]

    # -------------------------------------------------------------- markets
    specs = [(course, q, ["Yes", "No"]) for course, q in BINARY_TEMPLATES] + MULTI_TEMPLATES
    rng.shuffle(specs)
    # put the demo market first so we can control it; remove its template duplicate
    specs = [s for s in specs if s[1] != BINARY_TEMPLATES[0][1]]
    specs.insert(0, (BINARY_TEMPLATES[0][0], BINARY_TEMPLATES[0][1], ["Yes", "No"]))
    n_live = 15
    markets, outcomes = [], []
    term_days = (NOW - TERM_START).days
    for k, (course, question, labels) in enumerate(specs):
        mid = DEMO_MARKET_ID if k == 0 else f"m-sim-{k:03d}"
        live = k == 0 or k > len(specs) - n_live
        n = len(labels)
        true_p = [rng.gammavariate(1.2, 1) for _ in range(n)]
        s = sum(true_p)
        true_p = [x / s for x in true_p]
        if mid == DEMO_MARKET_ID:
            true_p = [0.62, 0.38]
        opened = TERM_START + timedelta(days=rng.uniform(1, term_days - 25 if not live else term_days - 6))
        closes = opened + timedelta(days=rng.uniform(7, 21)) if not live else NOW + timedelta(days=rng.uniform(5, 25))
        markets.append({
            "market_id": mid, "school_id": SCHOOL, "course": course, "question": question,
            "market_type": "binary" if n == 2 else ("numeric_range" if labels[0][0].isdigit() or "Below" in labels[0] or "Under" in labels[0] else "multiple_choice"),
            "status": "live" if live else "final",
            "liquidity_b": b,
            "creator_id": None,  # filled below
            "resolution_source": "https://registrar.wisc.edu" if course != "campus" else "https://uwbadgers.com",
            "created_at": opened - timedelta(days=1), "opens_at": opened, "closes_at": closes,
            "_true_p": true_p, "_live": live,
        })
        for j, lab in enumerate(labels):
            outcomes.append({"market_id": mid, "outcome_index": j, "label": lab, "q_shares": 0.0})

    # -------------------------------------------------------------- trades
    m_by_id = {m["market_id"]: m for m in markets}
    q_state = {m["market_id"]: [0.0] * len(m["_true_p"]) for m in markets}
    staked = {}               # (user, market) -> clout staked
    clout_now = {u["user_id"]: 0.0 for u in users}
    trades_by_market = {m["market_id"]: [] for m in markets}
    trades = []

    # market weights: live markets and the demo get more activity
    mw = [(2.0 if m["_live"] else 1.0) * rng.uniform(0.5, 1.5) for m in markets]
    mw[0] = 0  # demo market is traded explicitly below
    # schedule trade times inside each market's window; process chronologically with resolutions
    events = []
    for _ in range(n_trades - 600):
        m = rng.choices(markets, mw)[0]
        end = min(m["closes_at"], NOW)
        t = m["opens_at"] + (end - m["opens_at"]) * rng.random() ** 0.8
        events.append((t, "trade", m["market_id"]))
    for m in markets:
        if not m["_live"]:
            events.append((m["closes_at"] + timedelta(hours=rng.uniform(2, 30)), "resolve", m["market_id"]))
    events.sort(key=lambda e: (e[0], e[1] == "trade"))

    resolutions = []
    tid = 0

    def place(t, user_id, mid, outcome, amount):
        nonlocal tid
        q = q_state[mid]
        new_q, sh, _ = c.apply_trade(q, outcome, amount, m_by_id[mid]["liquidity_b"])
        q_state[mid] = new_q
        staked[(user_id, mid)] = staked.get((user_id, mid), 0.0) + amount
        tid += 1
        row = {"trade_id": f"t-sim-{tid:06d}", "market_id": mid, "user_id": user_id, "outcome_index": outcome,
               "clout_spent": round(amount, 4), "shares": sh,
               "price_before": c.prices(q, m_by_id[mid]["liquidity_b"])[outcome],
               "prices_after": c.prices(new_q, m_by_id[mid]["liquidity_b"]),
               "user_clout_at_trade": clout_now[user_id], "created_at": t}
        row["post_price"] = row["prices_after"][outcome]
        trades.append(row)
        trades_by_market[mid].append(row)

    def decide(user_id, m, p_now):
        arch = arch_of[user_id]
        n = len(p_now)
        if arch == "herd":
            return max(range(n), key=lambda j: p_now[j])
        if arch == "troll":
            return min(range(n), key=lambda j: p_now[j])
        belief = [_clip(p + rng.gauss(0, noise[arch])) for p in m["_true_p"]]
        s = sum(belief)
        belief = [x / s for x in belief]
        return max(range(n), key=lambda j: belief[j] - p_now[j])

    for t, kind, mid in events:
        m = m_by_id[mid]
        if kind == "resolve":
            winner = rng.choices(range(len(m["_true_p"])), m["_true_p"])[0]
            m["_winner"] = winner
            per_user = {}
            for tr in trades_by_market[mid]:
                per_user.setdefault(tr["user_id"], []).append((tr["outcome_index"], tr["clout_spent"], tr["shares"]))
            for uid, trs in per_user.items():
                clout_now[uid] += c.net_clout_change(trs, winner)
            resolver = max(clout_now, key=clout_now.get)
            resolutions.append({"market_id": mid, "winning_outcome_index": winner, "resolved_by": resolver,
                                "rationale": "Simulated resolution from the listed source.",
                                "resolved_at": t, "dispute_deadline": t + timedelta(hours=24),
                                "final_at": t + timedelta(hours=24), "status": "final"})
            continue
        uid = rng.choices(users, activity)[0]["user_id"]
        room = c.remaining_bet(clout_now[uid], staked.get((uid, mid), 0.0))
        if room < 1:
            continue
        p_now = c.prices(q_state[mid], m["liquidity_b"])
        outcome = decide(uid, m, p_now)
        amount = min(room, c.MIN_BET * rng.uniform(0.5, 1.0) if room <= c.MIN_BET else rng.uniform(c.MIN_BET * 0.5, room))
        place(t, uid, mid, outcome, round(max(1.0, amount), 2))

    # -------------------------------------------------------------- demo market: 35% crowd, ~60% smart money
    demo = m_by_id[DEMO_MARKET_ID]
    t0, t1 = demo["opens_at"], NOW - timedelta(hours=1)
    smart = sorted([u for u in users if clout_now[u["user_id"]] > 0], key=lambda u: -clout_now[u["user_id"]])
    crowd = [u for u in users if clout_now[u["user_id"]] <= 0]
    n_demo = 0
    ts = lambda k, n: t0 + (t1 - t0) * (k / n)  # noqa: E731

    def demo_smart():
        st = [(clout_now[tr["user_id"]], tr["outcome_index"], tr["clout_spent"]) for tr in trades_by_market[DEMO_MARKET_ID]]
        return c.smart_money(st, 2)

    # interleave: smart users mostly YES, crowd mostly NO; stop when both targets are hit
    si = ci = 0
    for step in range(1500):
        p_yes = c.prices(q_state[DEMO_MARKET_ID], b)[0]
        sm = demo_smart()
        if step > 200 and abs(p_yes - 0.35) < 0.01 and sm and abs(sm[0] - 0.60) < 0.02:
            break
        want_smart_yes = sm is None or sm[0] < 0.60
        if step % 3 == 0 and smart:
            u = smart[si % len(smart)]
            si += 1
            outcome = 0 if want_smart_yes else 1
        else:
            u = crowd[ci % len(crowd)]
            ci += 1
            outcome = 1 if p_yes > 0.35 else 0
        uid = u["user_id"]
        room = c.remaining_bet(clout_now[uid], staked.get((uid, DEMO_MARKET_ID), 0.0))
        if room < 1:
            continue
        place(ts(step, 1500), uid, DEMO_MARKET_ID, outcome, round(min(room, rng.uniform(5, 10)), 2))
        n_demo += 1
    # spread the demo trades evenly over the market's life so the chart fills the whole window
    demo_trades = sorted(trades_by_market[DEMO_MARKET_ID], key=lambda r: r["created_at"])
    for k, row in enumerate(demo_trades):
        row["created_at"] = t0 + (t1 - t0) * ((k + 1) / len(demo_trades)) ** 0.9
    trades_by_market[DEMO_MARKET_ID] = demo_trades

    # -------------------------------------------------------------- finish rows
    for u in users:
        u["clout"] = round(clout_now[u["user_id"]], 4)
    by_clout = sorted(users, key=lambda u: -u["clout"])
    for k, m in enumerate(markets):
        m["creator_id"] = by_clout[k % 40]["user_id"]
    for o in outcomes:
        o["q_shares"] = q_state[o["market_id"]][o["outcome_index"]]

    comments = []
    cid = 0
    for m in markets:
        pool = trades_by_market[m["market_id"]]
        for _ in range(rng.randint(3, 9) if pool else 0):
            tr = rng.choice(pool)
            p = round(100 * tr["prices_after"][0])
            cid += 1
            comments.append({
                "comment_id": f"c-sim-{cid:05d}", "market_id": m["market_id"], "user_id": tr["user_id"],
                "body": rng.choice(COMMENT_TEMPLATES).format(p=p, dir=rng.choice(["high", "low"]),
                                                             side=rng.choice(["yes", "no"])),
                "created_at": tr["created_at"] + timedelta(minutes=rng.uniform(1, 600)),
            })

    for m in markets:
        m.pop("_true_p")
        m.pop("_live")
        m.pop("_winner", None)

    rows = {
        "users_raw": users, "markets_raw": markets, "outcomes_raw": outcomes,
        "trades_raw": sorted(trades, key=lambda r: r["created_at"]),
        "resolutions_raw": resolutions, "comments_raw": comments, "disputes_raw": [],
    }
    for table in rows.values():
        for r in table:
            r["is_simulated"] = True
    return rows


if __name__ == "__main__":
    import time
    t = time.time()
    out = simulate()
    print({k: len(v) for k, v in out.items()}, f"{time.time() - t:.1f}s")
    cl = sorted(u["clout"] for u in out["users_raw"])
    print("clout min/median/max", cl[0], cl[len(cl) // 2], cl[-1], "negative:", sum(x < 0 for x in cl))
    demo_q = [o["q_shares"] for o in out["outcomes_raw"] if o["market_id"] == DEMO_MARKET_ID]
    print("demo crowd yes", round(c.prices(demo_q)[0], 3))
    clout_of = {u["user_id"]: u["clout"] for u in out["users_raw"]}
    st = [(clout_of[t["user_id"]], t["outcome_index"], t["clout_spent"]) for t in out["trades_raw"] if t["market_id"] == DEMO_MARKET_ID]
    print("demo smart money yes", round(c.smart_money(st, 2)[0], 3), "demo trades", len(st))
    from collections import Counter
    print(Counter(u["archetype"] for u in sorted(out["users_raw"], key=lambda u: -u["clout"])[:100]))
