# CLAUDE.md — The Curve

> Single source of truth for every teammate and every Claude Code session. Read it before writing code.
> If a decision changes, update this file in the same commit.

**Rule zero: Before building any feature, decide where Databricks touches it. If a feature has no Databricks component, flag it.**

---

## 0. Current repo state (as of 2026-11-14)

The Databricks base and a first version of the website are built and deployed (on `main`):
- **Data:** simulated campus in `the_curve.bronze`, Lakeflow pipeline producing silver/gold, Lakebase ledger seeded with the same data.
- **Website:** Next.js app in `/app`, deployed as the Databricks App **`the-curve`**: purple board UI, markets, betting, AI analyst, comments, leaderboard, profiles.
- **Accounts:** passwordless university email login (pick your school, verify an email at its domain); accounts, sign-in tokens, sessions and schools live in Lakebase. REST API under `/api` (see §4 "REST API").
- **Multi-university:** students from any university can join. Leaderboards exist for every school plus a school-vs-school league, and everyone can view every school's board.
- **Not built yet:** market proposal/upvotes, resolution + disputes UI, Fade button, Syllabus→Markets, Genie space, MLflow models, Waitlist Odds, Swap Chains.

### Databricks workspace and team access (set up 2026-11-14)
- **Workspace (Free Edition):** `https://dbc-9eafb64f-74c3.cloud.databricks.com`
- All four teammates are workspace users and members of the workspace group **`the-curve-team`**. Musa is the workspace admin; ask him to add or remove people. This repo is public, so **don't put teammate emails, tokens, or other credentials in it.**
- **Unity Catalog grants go to `account users`, not `the-curve-team`:** UC can only grant to account-level groups, and on Free Edition the account contains just this workspace's users (our team). `account users` has `ALL PRIVILEGES` on `the_curve` and `the_curve_ledger`.
- In the workspace: SQL warehouse "Serverless Starter Warehouse" (`d3933f49c3b5beb3`), Lakebase project `the-curve-ledger`, Databricks App `the-curve`, Foundation Model endpoints (we use `databricks-meta-llama-3-3-70b-instruct`), Genie.

**Get access (each teammate, once):**
1. Accept the invite email and sign in at the workspace URL with the email you were invited with.
2. Install the Databricks CLI: `brew install databricks/tap/databricks`. If Homebrew fails with "Command Line Tools are too outdated", download the `darwin_arm64` zip from the [CLI releases](https://github.com/databricks/cli/releases), unzip it, and put the `databricks` binary in `~/.local/bin` (make sure that folder is on your `PATH`).
3. Log in: `databricks auth login --host https://dbc-9eafb64f-74c3.cloud.databricks.com`, then enter `DEFAULT` as the profile name and sign in in the browser.
4. Check: `databricks current-user me` prints your user, and its groups include `the-curve-team`.

---

## 1. Project overview

- **Name:** The Curve (working name). **Currency:** Clout.
- **One-liner:** "Bet your Clout, not your cash." A prediction market for college students where you stake your reputation, not money, on things students care about. Started at UW-Madison (the current markets are about UW), open to students from any university.
- **Context:** 24-hour hackathon (MadHacks). We compete in the **Databricks track**, so Databricks is central to the product, not an add-on.
- **Universities:** every user and market has a `school_id`. Listed schools (name, short name, email domain, color) are in `app/src/core/universities.json`, which is shared by the app and the simulation. Students from unlisted schools sign up with any `.edu` email and get `school_id = edu-<domain>`. Next: per-school market spaces.

---

## 2. Core feature: prediction markets with Clout

### Clout rules (implement exactly)
- Everyone starts at **100 Clout** (`STARTING_CLOUT`).
- **No per-market limiter.** The only cap is your balance: betting **spends Clout immediately**, and you can't bet more than you have **available**.
- Each winning share pays **1 Clout** when the market resolves; losing shares pay 0.
- **Clout** (shown everywhere, ranked on leaderboards) = `100 + realized profit` = available balance + Clout tied up in open bets. **Available** = what you can bet right now (`users.clout` in the ledger).
- Betting alone can't push you below 0. Penalties (voided market, overturned resolution) can; negative Clout renders in red.
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
- **Leaderboards:** a **University league** (schools ranked by average Clout of their forecasters, `gold.school_rankings`), a board **for every university** (`scope = 'school'`), all students combined, and by major, dorm, club and course, plus a **Hall of Shame** (bottom of the board). All boards are public to every signed-in or signed-out visitor.
- **Calibration score** on every profile ("when you say 70%, you're right 71% of the time"), based on Brier score.
- **Flair**, e.g. "Oracle of Econ 301", "Inverse Oracle".
- **Smart Money line:** a second price line per market, stakes weighted by each user's **realized profit**, counting only users who have made Clout (profit > 0).
- **Fade button:** bet against the bottom-ranked forecasters' net position in this market.

### AI market analyst (built)
Every market has an **AI market analyst** panel. It explains the market; it never bets, never tells anyone what to bet, and never discusses individual students.
- **Batch insight (Databricks-native):** `databricks/notebooks/30_ai_analyst_batch.py` builds a context per live market (question, crowd vs Smart Money from gold, 24h activity, price move, recent comments) and calls **`ai_query`** with a JSON-schema response → `the_curve.gold.market_ai_insights` (`summary`, `why_price_moved`, `crowd_vs_smart_money`, `comment_sentiment`, `mispricing_flag`, `confidence`). Each call is logged as an **MLflow trace** in the experiment `/Users/<you>/the-curve-ai-analyst`. Runs as the last task of the `refresh` job.
- **Live "Ask the AI":** `POST /api/markets/[id]/ask` (`app/src/server/analyst.ts`) pulls fresh context (live prices and comments from Lakebase, Smart Money and the batch insight from gold), streams an answer from the Foundation Model endpoint, and logs each Q&A to the Lakebase table `ai_questions` (synced to `bronze.ai_questions_raw`).
- Guardrails live in the system prompts in both files; keep them identical in spirit when editing.
- Model is one variable: `ai_model` in `databricks.yml` / `DATABRICKS_AI_MODEL` (default `databricks-meta-llama-3-3-70b-instruct`).
- Next AI features (not built): **AI resolver** (propose outcome from an announcement; a 500+ human confirms) and **Syllabus→Markets**, both via `ai_query`.

### Rules and safety
- University email login only, one account per email (see "Accounts and login" in §4). Note: the app is hosted on Databricks Apps, which puts a Databricks sign-in in front of it, so only workspace members can reach it until it's hosted publicly.
- No markets about individual students.
- Instructors/TAs cannot trade on their own course's markets.
- All demo data is **simulated** and must be **labeled as such** in the UI.

---

## 3. Secondary features (stretch — only after core works)

- **Waitlist Odds:** multi-factor model (enrollment appointment time, credits/class standing, major and reserved seats, waitlist position, section size, historical drop rate, days to drop deadline, live market prices as an input). Trained and logged in MLflow.
- **Swap Chains:** find 2–4 person section swap cycles via graph cycle detection. UW routes open seats in waitlisted sections to the waitlist, so swaps are sent as **pre-matched requests to departments**, never executed directly.

---

## 4. Databricks: use it early and often (CRITICAL)

### Databricks products we use (and how)
| Product | Our use | Where |
|---|---|---|
| **Asset Bundles** | All jobs, the pipeline and the app are code. `databricks bundle deploy -t dev` (your own copy, prefixed with your name) or `-t prod` (shared, deploy from `main` only). | `databricks.yml`, `resources/*.yml` |
| **Unity Catalog** | Catalog `the_curve` (bronze/silver/gold/ml/ai) + `the_curve_ledger` (the Lakebase DB, readable from Spark/SQL). | `databricks/sql/00_setup_catalog.sql` |
| **Lakebase** (Postgres) | Live trade ledger. Project `the-curve-ledger`, branch `production`, DB `databricks_postgres`. Auth = short-lived OAuth credential, no passwords. | `db/schema.sql`, `app/src/server/ledger.ts` |
| **Lakeflow Jobs** (serverless) | `simulate_and_build` (sim → seed Lakebase → pipeline) and `refresh` (every 15 min: Lakebase → bronze → pipeline → AI analyst). | `resources/data.yml` |
| **Lakeflow Declarative Pipelines** | `the-curve-medallion`: silver + gold materialized views. | `databricks/pipelines/*.sql` |
| **SQL warehouse** | App reads gold via the Statement Execution API. | `app/src/server/warehouse.ts` |
| **Foundation Model APIs + `ai_query`** | AI market analyst (batch in SQL, live chat from the app). | `30_ai_analyst_batch.py`, `app/src/server/analyst.ts` |
| **MLflow** | Traces for every batch analyst call. Models (market accuracy, waitlist odds) still to do. | `30_ai_analyst_batch.py` |
| **Databricks Apps** | Hosts the Next.js site as `the-curve`, with the warehouse, model endpoint and Lakebase attached as app resources. | `resources/app.yml`, `app/app.yaml` |
| **Git folders** | Teammates edit notebooks in the workspace, synced to this GitHub repo. | see "Connecting GitHub" below |

### Architecture split
- **App layer (Next.js + Tailwind, on Databricks Apps):** UI, identity, live trading, live AI chat.
- **Transactional DB: Databricks Lakebase.** The trade ledger lives here for realtime betting. The DB layer is plain Postgres (`pg`), so Supabase stays a fallback.
- **Databricks = data and intelligence brain:** computes canonical Clout stats, calibration, leaderboards, Smart Money, and all ML/AI features. The app **reads** these results from gold. (The app also stores `users.clout` in the ledger to enforce bet limits instantly; it must equal gold `user_clout`.)

### Connecting GitHub (each teammate, once)
1. Workspace → avatar → **Settings → Linked accounts → Git integration → GitHub → Link**, and authorize the Databricks GitHub App for `FayzaanV/madhacks2026`.
2. **Workspace → Create → Git folder** → `https://github.com/FayzaanV/madhacks2026`. Pull, branch, and commit from the workspace.
3. Deploy with the CLI from a laptop or the Git folder: `databricks bundle deploy -t dev`.

### Accounts and login (any university, passwordless)
- `POST /api/auth/request {email, school_id}`: the email must be at the chosen school's domain (subdomains OK, e.g. `cs.wisc.edu`); `school_id: "other"` accepts any `.edu` and maps it to a listed school if the domain matches (`schoolForEmail` in `app/src/core/universities.ts`, with tests). Rate limits: 3 links per email per 15 min, 10 per IP per hour (SHA-256 of the proxy-appended last `x-forwarded-for` hop; raw IPs never stored), 300 per hour overall. Only the **SHA-256** of a random token is stored, in Lakebase `login_tokens` (15 min, single use). The link `/login/verify?token=…` is emailed via **Resend**. On verify the school is re-derived from the verified email and inserted into `schools` if new.
- **Demo mode is opt-in.** Showing the link on screen lets anyone sign in as anyone, so it only happens when there's no `RESEND_API_KEY` **and** `DEMO_LOGIN=1` is set (or you're running `next dev` locally). A production server with neither returns 503 "Email sign-in isn't set up". Never set `DEMO_LOGIN=1` on a public deployment; on the Databricks App it's tolerable only because Databricks sign-in already limits access to workspace members.
- `/login/verify` needs a click (POST to `/api/auth/verify`) so email link scanners can't use up the token. Verifying creates the user if new (100 Clout) and a session: random id in an `httpOnly`, `Secure`, `SameSite=Lax` cookie `curve_session`; only its SHA-256 is stored in `sessions` (30 days).
- **Usernames:** new accounts get a random placeholder (`brave_wolf6383`), never derived from the email, so school IDs aren't exposed. After the first sign-in the app sends you to `/welcome` to pick one; change it later on `/me`. Rules: 3–20 chars `[a-z0-9_]`, case-insensitively unique across everyone (simulated users included), reserved names blocked (`setHandle` in `app/src/server/auth.ts`, `PATCH /api/me`).
- No passwords anywhere. Sign-in links only point at `APP_ORIGIN`, localhost, or `the-curve-*.databricksapps.com` (forged Host headers are rejected).
- `sessions` sync to `bronze.sessions_raw` without the hash or email; `login_tokens` never leave Lakebase. Code: `app/src/server/auth.ts`.
- **Resend key:** create it at resend.com, then `databricks secrets create-scope the-curve` (once) and `databricks secrets put-secret the-curve resend_api_key`. Add a `secret` app resource for it in `resources/app.yml` and `RESEND_API_KEY` `valueFrom` in `app/app.yaml`. Locally put it in `app/.env.local`. Until a domain is verified in Resend, it only delivers to the Resend account owner's own address; set `RESEND_FROM` once a domain is verified.

### REST API (all data on Databricks: Lakebase for the ledger, SQL warehouse for gold)
| Method | Route | Auth | What |
|---|---|---|---|
| POST | `/api/auth/request` | – | email a sign-in link |
| POST | `/api/auth/verify` | – | token → session cookie |
| GET | `/api/auth/session` | – | current user or `null` |
| DELETE | `/api/auth/session` | – | sign out |
| GET | `/api/me` | ✓ | Clout, available, open stake, Brier, rank |
| PATCH | `/api/me` | ✓ | `{handle}` → pick or change your username (409 if taken) |
| DELETE | `/api/me` | ✓ | delete account (anonymized, trades kept) |
| GET | `/api/markets?q=&status=` | – | markets with live prices |
| GET | `/api/markets/:id` | – | market, Smart Money, AI insight |
| POST | `/api/markets/:id/trade` | ✓ | `{outcome, amount}` → spends Clout |
| GET / POST | `/api/markets/:id/comments` | – / ✓ | list / add |
| DELETE | `/api/comments/:id` | ✓ | delete your own comment |
| POST | `/api/markets/:id/ask` | ✓ | AI analyst (streamed text) |
Errors are `{ "error": "…" }` with 400/401/403/404/429. Route handlers are thin wrappers over `app/src/server/*`.

### Running things
```
python3 scripts/dbsql.py "SELECT * FROM the_curve.gold.leaderboard LIMIT 5"   # SQL on the warehouse
node app/scripts/ledger-sql.mjs "SELECT count(*) FROM trades"                # SQL on Lakebase
databricks bundle run -t dev simulate_and_build                              # rebuild sim data (TRUNCATES the ledger)
databricks bundle run -t dev refresh                                         # sync + pipeline + AI insights
databricks bundle run -t dev the_curve                                       # deploy the app
cd app && npm run dev                                                        # local app (uses your CLI login)
```
After the app is (re)created, grant its service principal access: `node app/scripts/ledger-sql.mjs grant-app <client-id>` and `GRANT USE CATALOG, USE SCHEMA, SELECT ON CATALOG the_curve TO \`<client-id>\`` (client id from `databricks apps get the-curve`).

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
| `bronze` | `schools_raw`, `sessions_raw`, `users_raw`, `markets_raw`, `outcomes_raw`, `trades_raw`, `resolutions_raw`, `disputes_raw`, `comments_raw`, `ai_questions_raw` |
| `silver` | `schools`, `users`, `markets`, `outcomes` (with crowd price), `trades_enriched` (trade + market + user + post-trade price), `resolutions` |
| `gold` | `school_rankings`, `user_clout`, `user_calibration` (bucketed curve; `user_id='__all__'` = campus), `user_brier`, `user_course_clout`, `leaderboard` (scope: overall/course/major/dorm/club, incl. `rank_from_bottom`), `market_smart_money`, `market_mispricing`, `market_price_history`, `user_flair`, `market_ai_insights` |
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
Locally the app needs none of these: it uses your `databricks` CLI login (`databricks auth token`) and defaults to the team workspace. Sign in at `http://localhost:3000/login` with any university email; without `RESEND_API_KEY` the sign-in link is shown on screen (demo mode). On Databricks Apps, credentials come from the app's service principal and its resources.

---

## 5. Repo structure

```
databricks.yml        Asset Bundle root (targets dev/prod, variables)
/resources            data.yml (pipeline + jobs), app.yml (Databricks App)
/app                  Next.js 16 + Tailwind app; app.yaml = Databricks Apps config
  /src/core           Shared TS core: lmsr.ts, clout.ts, scoring.ts (+ core.test.ts)
  /src/server         Server-only: databricks auth, warehouse, Lakebase ledger, markets, analyst, user
  /src/app            Pages + API routes (/api/markets/[id]/{trade,ask,comments})
  /scripts            ledger-sql.mjs (SQL on Lakebase, grant-app)
/lib/test-vectors.json  Shared fixtures so TS and Python implementations agree
/databricks
  /lib                clout.py (Python mirror of app/src/core) + simulate.py + tests
  /notebooks          01_simulate_data, 02_seed_lakebase, 10_sync_bronze, 30_ai_analyst_batch
  /pipelines          silver.sql, gold.sql (Lakeflow declarative pipeline)
  /sql                00_setup_catalog.sql
/db                   schema.sql for the Lakebase ledger
/scripts              dbsql.py (SQL on the warehouse), gen_test_vectors.py
CLAUDE.md
```
Numbered notebook prefixes = run order. The TS core lives in `app/src/core` (not `/lib`) because Databricks Apps only uploads the `app/` folder.

---

## 6. Key logic to keep correct

All of this lives in **one shared module** (`app/src/core/*.ts`, mirrored in `databricks/lib/clout.py`) with **unit tests** that both run against `lib/test-vectors.json`: `cd app && npm test` and `cd databricks/lib && python3 -m unittest test_clout`. The Python file is the reference: change it, run `python3 scripts/gen_test_vectors.py`, then make the TS pass. The gold SQL (`databricks/pipelines/gold.sql`) restates payout, Brier, calibration and Smart Money in SQL; keep it in step. Never reimplement these formulas anywhere else.

- **`b` default = 500**: a 10-Clout bet moves a 50/50 binary market by ~1 point.
- **Smart Money:** per outcome, `Σ profit_u · stake_u,k / Σ profit_u · stake_u` over users with realized profit > 0 (`smart_money` / `smartMoney`; callers pass profit as the weight).
- **Known quirk to revisit:** with forecast = post-trade price of the outcome bought, someone who buys a 5% long shot and loses gets a *good* Brier (0.05² ≈ 0.003). The Hall of Shame therefore shows losers with low Brier.

### LMSR
For outcomes `i` with outstanding shares `q_i` and liquidity `b`:
- Cost function: `C(q) = b * ln( Σ_j exp(q_j / b) )`
- Price (implied probability): `p_i = exp(q_i / b) / Σ_j exp(q_j / b)` (prices sum to 1)
- Cost to buy `Δ` shares of `i`: `C(q + Δ·e_i) − C(q)`
- Shares received for spending `a` Clout on `i` (closed form):
  `Δ = b * ln( (S·exp(a/b) − S + E_i) / E_i )`, where `S = Σ_j exp(q_j/b)`, `E_i = exp(q_i/b)`
- Use log-sum-exp (subtract `max q / b`) to avoid overflow.
- Max market-maker loss = `b * ln(N)`; pick `b` so a 10-Clout bet moves price by ~1 point.

### Clout balance
- `STARTING_CLOUT = 100`. `canAfford(balance, amount)` = `0 < amount <= balance`. A bet deducts `amount` from `users.clout` in the same Lakebase transaction that records the trade (`app/src/server/markets.ts` `placeTrade`).
- Gold: `user_clout.clout = 100 + realized_profit`, `available = clout - open_stake`.

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
