# CLAUDE.md — The Curve

> Single source of truth for every teammate and every Claude Code session. Read it before writing code.
> If a decision changes, update this file in the same commit.

**Rule zero: Before building any feature, decide where Databricks touches it. If a feature has no Databricks component, flag it.**

---

## 0. Current repo state (as of 2026-11-14)

The repo is empty apart from `README.md`, `LICENSE` (MIT), and a GitHub **Python** `.gitignore` template. No app code, no package manager, no Databricks assets yet. Everything under "Repo structure" below is the plan, not what exists.

- `.gitignore` ignores `.env` but **not** `node_modules/`, `.next/`, or `.env.local`. Add these before the first `npm install`.

---

## 1. Project overview

- **Name:** The Curve (working name). **Currency:** Clout.
- **One-liner:** "Bet your Clout, not your cash." A campus prediction market for UW-Madison students where you stake your reputation, not money, on things students care about.
- **Context:** 24-hour hackathon (MadHacks). We compete in the **Databricks track**, so Databricks is central to the product, not an add-on.
- **Future:** expand to other universities (per-school spaces, inter-campus leaderboards like a "Big Ten Forecasting League"). Put a `school_id` on users and markets from day one, even though only `uw-madison` exists.

---

## 2. Core feature: prediction markets with Clout

### Clout rules (implement exactly)
- Everyone starts at **0 Clout**.
- A user can **always** bet at least **10 Clout**, even with low or negative Clout.
- **Max bet per market = `max(10, 0.1 * clout)`**.
- Wins add to true Clout, losses subtract. **No floor**: Clout can go negative.
- True Clout is shown everywhere (profile, comments, leaderboards). **Negative Clout renders in red.**
- No real money anywhere. No purchasing Clout.

### Privilege tiers (by true Clout)
| Clout | Can |
|---|---|
| any | trade, comment |
| 250+ | propose markets |
| 500+ | resolve markets |
| 1000+ | moderate, settle disputes |

Creators and resolvers put Clout at risk: a **voided market** costs the creator Clout; an **overturned resolution** costs the resolver Clout.

### Market types
- **Binary** (yes/no), **multiple choice**, **numeric range** (implemented as N buckets, i.e. multiple choice under the hood).
- Example markets: "Will the Econ 301 waitlist clear before the first day of class?", "Will a new section of CS 400 be added?", "Will Stat 340 fill within 1 hour of enrollment opening?", "How many seats open after the drop deadline?", "Will the midterm average be above 75?", plus campus markets (Badgers games, snow days, ASM elections).

### Market lifecycle
```
proposed --(~10 upvotes)--> live --(close time)--> closed --> resolved
                                                               |
                                              24h dispute window
                                                   |        |
                                             no dispute   disputed --> Clout-weighted vote --> final
```
- Creator sets a **resolution source** (URL or description) at creation.
- Every market has a **comment thread**.
- Statuses: `proposed | live | closed | resolved | disputed | final | voided`.

### Pricing
LMSR automated market maker with a configurable liquidity parameter `b` (per market, default in `lib/`). Small bets should barely move prices. Formulas in §6.

### Social features
- **Leaderboards** by course, major, dorm, club, plus a **Hall of Shame** (bottom of the board).
- **Calibration score** on every profile ("when you say 70%, you're right 71% of the time"), based on Brier score.
- **Flair**, e.g. "Oracle of Econ 301", "Inverse Oracle".
- **Smart Money line:** a second price line per market, weighted by Clout, counting only users with positive Clout.
- **Fade button:** bet against the bottom-ranked forecasters' net position in this market.

### Rules and safety
- `wisc.edu` login only, one account per student.
- No markets about individual students.
- Instructors/TAs cannot trade on their own course's markets.
- All demo data is **simulated** and must be **labeled as such** in the UI.

---

## 3. Secondary features (stretch — only after core works)

- **Waitlist Odds:** multi-factor model (enrollment appointment time, credits/class standing, major and reserved seats, waitlist position, section size, historical drop rate, days to drop deadline, live market prices as an input). Trained and logged in MLflow.
- **Swap Chains:** find 2–4 person section swap cycles via graph cycle detection. UW routes open seats in waitlisted sections to the waitlist, so swaps are sent as **pre-matched requests to departments**, never executed directly.

---

## 4. Databricks: use it early and often (CRITICAL)

### Architecture split
- **App layer (Next.js + Tailwind):** UI, auth, live trading.
- **Transactional DB:** **Databricks Lakebase** (managed Postgres) if our workspace has it; otherwise **Supabase**. The trade ledger lives here for realtime betting. Write the DB layer against plain Postgres so swapping is a connection-string change.
- **Databricks = data and intelligence brain:** computes canonical Clout stats, calibration, leaderboards, and all ML/AI features. The app **reads** these results.

### Data flow
```
  ┌────────────── Next.js app (UI, auth, trading) ──────────────┐
  │   writes trades/markets          reads leaderboards/stats   │
  └───────┬──────────────────────────────────────▲──────────────┘
          ▼                                      │
  ┌───────────────────┐                ┌─────────┴──────────┐
  │ Lakebase/Supabase │                │ Databricks SQL      │
  │ (Postgres ledger) │                │ warehouse           │
  └───────┬───────────┘                └─────────▲──────────┘
          │ sync job (schedule + on resolution)  │
          ▼                                      │
  ┌─────────── Unity Catalog: the_curve ─────────┴──────────────┐
  │ bronze ──► silver ──► gold ──► Genie / AI-BI dashboard       │
  │   ▲                    │                                     │
  │ sim notebook       MLflow models ─► Model Serving (optional) │
  │                    ai_query(): Syllabus→Markets, AI resolver │
  └──────────────────────────────────────────────────────────────┘
```

### Components (build priority order)
1. **Simulated data notebook — build FIRST (hour 0).** ~2,000 students, ~50 markets, ~20,000 trades with realistic behavior archetypes: good forecasters, bad forecasters, trolls, herd followers. Write to Delta tables in `the_curve.bronze`. Every row gets `is_simulated = true`.
2. **Medallion pipeline on Delta Lake** (Lakeflow/DLT pipeline or scheduled notebooks):
   - **Bronze:** raw trades, markets, resolutions synced from the app DB.
   - **Silver:** cleaned trades joined with markets and users.
   - **Gold:** per-user Clout, Brier score, calibration curve, leaderboard ranks, Smart Money prices per market.
   - App leaderboards and profile stats read gold tables via a **Databricks SQL warehouse**.
3. **Sync job:** app DB → bronze on a short schedule (e.g. every 5 min) and on each resolution. Document exactly how it runs in `databricks/README.md` once built.
4. **MLflow:** train and log the market-accuracy and waitlist-odds models; track experiments; serve via Model Serving if time allows.
5. **AI Functions (`ai_query` in SQL):** "Syllabus to Markets" (upload a syllabus → generate markets per exam/deadline) and the **AI resolver** (paste an announcement → propose an outcome + rationale; a 500+ human still confirms).
6. **Genie space / AI-BI dashboard ("Ask Clout"):** NL analytics, e.g. "Which courses have the most mispriced markets?", "Do high-Clout users beat the crowd?"
7. **Bonus:** host the app on **Databricks Apps** if the workspace supports it.

### Unity Catalog names
Catalog: **`the_curve`**

| Schema | Tables |
|---|---|
| `bronze` | `users_raw`, `markets_raw`, `outcomes_raw`, `trades_raw`, `resolutions_raw`, `disputes_raw`, `comments_raw` |
| `silver` | `users`, `markets`, `trades_enriched` (trade + market + user + post-trade price), `resolutions` |
| `gold` | `user_clout`, `user_calibration` (bucketed curve), `user_brier`, `leaderboard` (scope: overall/course/major/dorm/club, incl. bottom ranks), `market_smart_money`, `market_mispricing`, `user_flair` |
| `ml` | feature tables + registered models: `the_curve.ml.market_accuracy`, `the_curve.ml.waitlist_odds` |
| `ai` | `syllabus_uploads`, `generated_markets`, `resolver_suggestions` |

### Credentials and env vars
All secrets go in `.env.local` (app) / `.env` (scripts), **never committed**. Commit a `.env.example` with blank values. In Databricks, use secret scopes, not plaintext in notebooks.
```
DATABRICKS_HOST=
DATABRICKS_TOKEN=
DATABRICKS_WAREHOUSE_ID=        # SQL warehouse for gold reads
DATABRICKS_CATALOG=the_curve
DATABASE_URL=                   # Lakebase or Supabase Postgres
AUTH_SECRET=
```

---

## 5. Repo structure (planned)

```
/app                  Next.js + Tailwind app (App Router lives in /app/src/app)
/lib                  Shared TS core: lmsr.ts, clout.ts, scoring.ts (+ *.test.ts)
/lib/test-vectors.json  Shared fixtures so TS and Python implementations agree
/databricks
  /notebooks          00_simulate_data.py, 10_sync_bronze.py, 40_mlflow_*.py ...
  /pipelines          bronze → silver → gold pipeline definitions
  /sql                gold views, ai_query functions, Genie seed queries
  /lib                clout.py — Python mirror of /lib for simulation + gold math
/db                   Postgres schema + migrations for the trade ledger
/scripts              seed, sync, and dev helper scripts
CLAUDE.md
```
Numbered notebook prefixes = run order.

---

## 6. Key logic to keep correct

All of this lives in **one shared module** (`/lib`, mirrored in `/databricks/lib/clout.py`) with **unit tests** that both run against `/lib/test-vectors.json`. Never reimplement these formulas inline anywhere else.

### LMSR
For outcomes `i` with outstanding shares `q_i` and liquidity `b`:
- Cost function: `C(q) = b * ln( Σ_j exp(q_j / b) )`
- Price (implied probability): `p_i = exp(q_i / b) / Σ_j exp(q_j / b)` (prices sum to 1)
- Cost to buy `Δ` shares of `i`: `C(q + Δ·e_i) − C(q)`
- Shares received for spending `a` Clout on `i` (closed form):
  `Δ = b * ln( (S·exp(a/b) − S + E_i) / E_i )`, where `S = Σ_j exp(q_j/b)`, `E_i = exp(q_i/b)`
- Use log-sum-exp (subtract `max q / b`) to avoid overflow.
- Max market-maker loss = `b * ln(N)`; pick `b` so a 10-Clout bet moves price by ~1 point.

### Clout bet limit
- `maxBet(clout) = max(10, 0.1 * clout)` — applies to the user's **total stake in that market**.

### Payout
- Each share of the winning outcome pays **1 Clout**; losing shares pay 0.
- Net Clout change for a market = `Σ winning shares − Σ Clout spent`.
- Voided market: stakes refunded, creator penalized.

### Brier score and calibration
- Per forecast: `(f − o)²`, `f` = forecast probability, `o ∈ {0,1}`. User Brier = mean over resolved forecasts (lower is better).
- A trade's forecast `f` = **post-trade price** of the outcome the user bought.
- Calibration curve: bucket forecasts into 10% bins; per bin, compare mean `f` to hit rate.

---

## 7. Build priorities and demo

### Priority order
1. Databricks simulated data + medallion pipeline
2. Core market + LMSR + Clout betting
3. Gold tables powering leaderboards/profiles
4. `ai_query` Syllabus to Markets
5. Genie dashboard + MLflow
6. Stretch features (Waitlist Odds, Swap Chains)

### Demo flow (60–90 s)
1. Open a market at **35%** with the **Smart Money line at 60%**.
2. Bet live; watch the price move.
3. Resolve with the **AI resolver**; Clout updates.
4. Climb the leaderboard; show the **calibration chart**.
5. Switch to Databricks: pipeline graph, MLflow experiment, Genie answering a question.

Seed the simulation so this exact market exists (35% crowd / 60% smart money).

---

## 8. Working conventions

- Ship the demo path first; polish later.
- Small commits, clear messages.
- Never hardcode secrets.
- When in doubt, pick the option that uses Databricks more visibly.
- Keep CLAUDE.md updated when decisions change.
- Any change to Clout/LMSR/scoring math goes through `/lib` + tests, and updates the Python mirror in the same commit.
