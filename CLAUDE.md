# CLAUDE.md — Yomi

> Single source of truth for every teammate and every Claude Code session. Read it before writing code.
> If a decision changes, update this file in the same commit.

**Rule zero: Before building any feature, decide where Databricks touches it. If a feature has no Databricks component, flag it.**

---

## 0. Current repo state (as of 2026-11-14)

The Databricks base and a first version of the website are built and deployed (on `main`):
- **Data:** simulated campus in `the_curve.bronze`, Lakeflow pipeline producing silver/gold, Lakebase ledger seeded with the same data.
- **Website:** Next.js app in `/app`, deployed as the Databricks App **`yomi`**: purple board UI, markets, betting, AI analyst, comments, leaderboard, profiles.
- **Accounts:** passwordless university email login (pick your school, verify an email at its domain); accounts, sign-in tokens, sessions and schools live in Lakebase. REST API under `/api` (see §4 "REST API").
- **Multi-university:** students from any university can join. Leaderboards exist for every school plus a school-vs-school league, and everyone can view every school's board.
- **Resolution:** `POST /api/markets/:id/resolve` (500+ Clout, or an `ADMIN_EMAILS` account) pays 1 Clout per winning share into `users.clout` (or refunds every stake if voided), opens a 24h dispute window, and starts `yomi-refresh` so gold catches up in minutes. A resolve panel shows on the market page for eligible users.
- **Admins:** accounts in `ADMIN_EMAILS` can create markets (`/markets/new`, "+ New market" in the header; `POST /api/markets`) and resolve any market. Trading stops at `closes_at` ("awaiting resolution"); resolved/voided markets show a banner.
- **Whole Clout:** buys are whole Clout; sells ask for whole Clout to receive (exact shares via `sharesForProceeds`) or "Sell all" (the only fractional proceeds). Clout displays as whole numbers; the ledger keeps exact values.
- **Real vs simulated:** simulated demo users carry a "sim" badge everywhere bettors/commenters show; Activity and Top holders have a "Real people only" toggle. Comments scroll and page 50 at a time (`?before=` cursor), so none drop off.
- **Test markets (simulated, shared):** admins click "Create test markets closing tonight" on `/markets/new` (`POST /api/admin/test-markets {count}`): [Test] markets (`course = 'Test'`, `is_simulated`) closing every 30 min until 11:30pm Madison time, seeded with bets from simulated users. Pages ping `POST /api/sim/tick` (throttled to once a minute per server) which adds a few simulated bets and **auto-resolves closed test markets at random, weighted by the odds at close**, with one leaderboard refresh per batch. Admins can resolve early (Resolve panel) or settle all closed ones (`POST /api/admin/test-markets/settle`). Code: `app/src/server/testmarkets.ts`, `app/src/core/testmarkets.ts`. All of it lives in the shared production ledger, so everyone sees the same data.
- **Admin override:** on any resolved/voided market, admins get "Override resolution" (`POST /api/markets/:id/resolve {outcome, rationale, override: true}`): balances move by exactly the difference between the new and old outcome (`overrideDeltas` in `core/clout.ts`), and the rationale records the previous result.
- **Times:** everything is displayed in Madison time via `app/src/core/time.ts` (the server runs in UTC). The market form reads close times as Madison time. The board lists only open markets; closed-but-unsettled ones show under "Awaiting resolution".
- **Selling + portfolio:** sell shares back to the LMSR any time before resolution (Buy/Sell toggle). Market pages have a live odds chart (Lakebase, every trade) with range buttons and a scrub slider, Smart Money dashed (gold), a "Your position" card, and Activity / Top holders tabs showing everyone's bets by @username. `/portfolio`: positions, P&L, trade history, Clout-over-time chart (gold `user_clout_history`).
- **Profiles:** uploaded profile pictures (128px, in Lakebase, never synced to bronze) with an initials fallback; a title you pick from earned titles (Clout tiers in `core/titles.ts` + gold flair), shown in the header, comments and bets.
- **Not built yet:** market proposal/upvotes, disputes (an overturn would have to reverse the payouts), Fade button, Syllabus→Markets, Genie space, MLflow models, Waitlist Odds, Swap Chains.

### Databricks workspace and team access (set up 2026-11-14)
- **Workspace (Free Edition):** `https://dbc-9eafb64f-74c3.cloud.databricks.com`
- All four teammates are workspace users and members of the workspace group **`the-curve-team`**. Musa is the workspace admin; ask him to add or remove people. This repo is public, so **don't put teammate emails, tokens, or other credentials in it.**
- **Unity Catalog grants go to `account users`, not `the-curve-team`:** UC can only grant to account-level groups, and on Free Edition the account contains just this workspace's users (our team). `account users` has `ALL PRIVILEGES` on `the_curve` and `the_curve_ledger`.
- In the workspace: SQL warehouse "Serverless Starter Warehouse" (`d3933f49c3b5beb3`), Lakebase project `the-curve-ledger`, Databricks App `yomi`, Foundation Model endpoints (we use `databricks-meta-llama-3-3-70b-instruct`), Genie.

**Get access (each teammate, once):**
1. Accept the invite email and sign in at the workspace URL with the email you were invited with.
2. Install the Databricks CLI: `brew install databricks/tap/databricks`. If Homebrew fails with "Command Line Tools are too outdated", download the `darwin_arm64` zip from the [CLI releases](https://github.com/databricks/cli/releases), unzip it, and put the `databricks` binary in `~/.local/bin` (make sure that folder is on your `PATH`).
3. Log in: `databricks auth login --host https://dbc-9eafb64f-74c3.cloud.databricks.com`, then enter `DEFAULT` as the profile name and sign in in the browser.
4. Check: `databricks current-user me` prints your user, and its groups include `the-curve-team`.

---

## 1. Project overview

- **Name:** Yomi (renamed from "The Curve" on 2026-11-14). **Currency:** Clout.
  - User-facing name, Databricks App (`yomi`, so the URL is `yomi-<workspace-id>.<region>.databricksapps.com`) and job/pipeline names say Yomi. Internal identifiers keep the old name on purpose, because renaming them would orphan existing data or deployments: catalog `the_curve`, Lakebase project `the-curve-ledger`, bundle name `the_curve`, cookie `curve_session`.
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
- Instructors/TAs cannot trade on their own course's markets: list them in the Lakebase `course_staff (user_id, course, role)` table; `placeTrade` rejects their trades with a 403. (`users.is_instructor` is legacy and unused.)
- Rate limits: 20 trades per user per minute, 10 AI analyst questions per user per hour (every question is a Foundation Model call on our Free Edition quota).
- All demo data is **simulated** and must be **labeled as such** in the UI.

---

## 2b. Union markets (live venue data, enterprise-ready)

Markets about the Wisconsin Union ("Will the Sett be at least 80% full at 7pm?", "Will the Strada wait hit 6+ min at noon?", "Will Strada sell 270+ items by 2pm?") that **open and settle themselves from data**. Page: `/union` (tab "Union"); partner dashboard: `/partners`.

- **Data sources, in settlement priority:** `partner` (the Union point of sale / any system pushing `POST /api/partner/metrics` with a Bearer key) → `occuspace` (Waitz/Occuspace Wi-Fi sensors, already deployed in the Terrace, Rathskeller and Sett; needs a token from the Union in secret `the-curve/occuspace_token`, adapter in `databricks/lib/occuspace.py` is **unverified until we have one**) → `sim` (simulated feed, `databricks/lib/venues.py`, `is_simulated = true`, labeled in the UI). If none covers a window: median of 3+ student check-ins (`venue_reports`); otherwise the market is **voided**.
- **Tables (Lakebase):** `venues`, `venue_metrics` (append-only; metrics `people`, `occupancy_pct`, `wait_min`, `line_len`, `sales` = cumulative today), `venue_reports`, `market_rules` (venue, metric, op, threshold, window, agg avg/max/last), `partners` (API key SHA-256 only; never synced). Union markets are ordinary binary markets with `course = 'Union'`, created by system user `yomi_union`.
- **Isolation:** the Union views live in their own pipeline (`databricks/pipelines/union.sql`, `yomi-union-pipeline`). `yomi-refresh` runs sync → medallion → AI analyst first, then the Union tasks with `run_if: ALL_DONE`, so a Union failure (e.g. tables not applied yet) never stops leaderboards. Union pages show "not connected yet" until the tables exist.
- **Jobs:** `yomi-union-markets` (daily 6am CT, `41_union_markets.py`) opens one market per template in `databricks/lib/union.py`; threshold = median of the same window on past days (same weekday when possible) so markets open near 50/50; trading closes 15 min before the window. `yomi-refresh` ends with `40_union_feed.py` (sensor or simulated readings), `42_union_settle.py` (decide + pay out) and the Union pipeline, every 15 min. Settlement uses `union.settle`, which **must stay identical to `resolveMarket`** in `markets.ts` (same lock order and credits; tested in `test_union.py`).
- **Gold:** `venue_baselines` (p25/p50/p75 by weekday and hour), `union_forecasts`, `union_market_scores`, `union_accuracy` (crowd vs venue-history Brier per venue: the partner scorecard).
- **Partners:** admins create/revoke keys on `/partners` (key shown once). `GET /api/partner/forecasts` returns the crowd forecast; on Databricks the gold tables can be shared with Delta Sharing (if enabled on the workspace). Union staff see `/partners` via secret `the-curve/partner_emails`.
- **Lakebase writes from jobs** run as whoever deployed last, who therefore needs a Lakebase Postgres role.

## 2c. Varsity sports and intramurals (auto-resolving)
**Varsity (Big Ten, from ESPN):**
- **Source:** ESPN's public scoreboard JSON (`site.api.espn.com/apis/site/v2/sports/...`). It's unofficial and keyless and may change, so keep parsing in one place: `app/src/core/sports.ts`, tested against recorded events in `app/src/core/fixtures/espn-events.json`.
- **Coverage:** football, men's and women's basketball, men's and women's hockey, and volleyball, for the 18 Big Ten schools. Their `espn_id` (the same id in every sport) is in `app/src/core/universities.json`.
- **Markets per game:**
  - winner;
  - over/under (ESPN's line if given, else the two teams' season average, rounded to .5);
  - winning margin (buckets per sport);
  - overtime, except volleyball.
  - Created 4 days ahead and phrased around the Big Ten team (the home team if both are). `category='sports'`, `event_ref` = ESPN event id, `auto_resolve=true`, created by `u-yomi-sports`.
- **Trading closes at the scheduled start.** There's no in-game trading.
- **Team props only:** no player props and no parlays (players are students).
- **Settlement:** when ESPN marks the game final, `settleMarket` (same payout code as manual resolution) resolves each market as `u-yomi-sports`. Postponed or canceled games void the markets. A tie voids the winner and margin markets.
- **The poller** (`app/src/server/pollers.ts`, started by `app/src/instrumentation.ts`) runs inside the app every 60 s:
  - schedules hourly;
  - live scoreboards only for sports with a game on. Use ESPN `groups=5` for football and `groups=7` for basketball; never `groups=50`, which silently drops games;
  - create markets, settle finals, auto-confirm intramurals.
  - A `poller_leases` row ensures only one instance runs: the deployed app or a teammate's `npm run dev`.
  - Set `SPORTS_POLLER=0` to disable it locally.
- **Pages and API:** the `/sports` page; `GET /api/sports/games`, `GET /api/sports/games/:id` (live score; market pages re-check every 30 s); admin `POST /api/sports/sync` to run a poller pass now.

**Intramurals (UW Rec Well on FusionPlay):**
- **FusionPlay has no public data or API.** It's login-only, and Innosoft's terms forbid copying. So:
  - admins create a league on `/intramurals` and paste the schedule from FusionPlay as CSV (`date,time,home,away,location`, Central time);
  - teams and a winner market per game (`category='intramural'`, `event_ref='im:<game_id>'`) are created automatically;
  - admins assign each team's captain by Yomi email.
- **After the game:** one captain reports the score, and the **other captain confirms**, which resolves the market as `u-yomi-im`. Or they dispute it, and an admin decides (final score, forfeit or cancel). An unanswered report **auto-confirms after 2 hours**.
- **Captains can't trade their own game's market.** Rules are in `app/src/core/intramurals.ts`, with tests.
- To replace manual setup later, ask imsports@recwell.wisc.edu for a results feed.

**Databricks:**
- `10_sync_bronze` copies `sports_games` and the `im_*` tables to bronze.
- Gold adds `sports_market_accuracy` (crowd closing price vs result, by sport and market type) and `im_standings`.
- The AI analyst sees the game's live or final score.

## 3. Secondary features (stretch — only after core works)

- **Waitlist Odds:** multi-factor model (enrollment appointment time, credits/class standing, major and reserved seats, waitlist position, section size, historical drop rate, days to drop deadline, live market prices as an input). Trained and logged in MLflow.
- **Swap Chains:** find 2–4 person section swap cycles via graph cycle detection. UW routes open seats in waitlisted sections to the waitlist, so swaps are sent as **pre-matched requests to departments**, never executed directly.

---

## 4. Databricks: use it early and often (CRITICAL)

### Databricks products we use (and how)
| Product | Our use | Where |
|---|---|---|
| **Asset Bundles** | All jobs, the pipeline and the app are code. **One shared deployment:** `databricks bundle deploy` (target `prod`, the default) from an up-to-date `main`. | `databricks.yml`, `resources/*.yml` |
| **Unity Catalog** | Catalog `the_curve` (bronze/silver/gold/ml/ai) + `the_curve_ledger` (the Lakebase DB, readable from Spark/SQL). | `databricks/sql/00_setup_catalog.sql` |
| **Lakebase** (Postgres) | Live trade ledger. Project `the-curve-ledger`, branch `production`, DB `databricks_postgres`. Auth = short-lived OAuth credential, no passwords. | `db/schema.sql`, `app/src/server/ledger.ts` |
| **Lakeflow Jobs** (serverless) | `simulate_and_build` (sim → seed Lakebase → pipeline) and `refresh` (every 15 min **and** after each resolution, runs queued: Lakebase → bronze → pipeline → AI analyst). The sync MERGEs only new rows of append-only `trades` / `ai_questions` (1h overlap); small mutable tables are snapshotted; widget `full_refresh=true` rewrites everything. | `resources/data.yml` |
| **Lakeflow Declarative Pipelines** | `the-curve-medallion`: silver + gold materialized views. | `databricks/pipelines/*.sql` |
| **SQL warehouse** | App reads gold via the Statement Execution API. | `app/src/server/warehouse.ts` |
| **Foundation Model APIs + `ai_query`** | AI market analyst (batch in SQL, live chat from the app). | `30_ai_analyst_batch.py`, `app/src/server/analyst.ts` |
| **MLflow** | Traces for every batch analyst call. Models (market accuracy, waitlist odds) still to do. | `30_ai_analyst_batch.py` |
| **Databricks Apps** | Hosts the Next.js site as `yomi`, with the warehouse, model endpoint and Lakebase attached as app resources. | `resources/app.yml`, `app/app.yaml` |
| **Git folders** | Teammates edit notebooks in the workspace, synced to this GitHub repo. | see "Connecting GitHub" below |

### Architecture split
- **App layer (Next.js + Tailwind, on Databricks Apps):** UI, identity, live trading, live AI chat.
- **Transactional DB: Databricks Lakebase.** The trade ledger lives here for realtime betting. The DB layer is plain Postgres (`pg`), so Supabase stays a fallback.
- **Databricks = data and intelligence brain:** computes canonical Clout stats, calibration, leaderboards, Smart Money, and all ML/AI features. The app **reads** these results from gold. (The app also stores `users.clout` in the ledger to enforce bet limits instantly; it must equal gold `user_clout`.)

### Connecting GitHub (each teammate, once)
1. Workspace → avatar → **Settings → Linked accounts → Git integration → GitHub → Link**, and authorize the Databricks GitHub App for `FayzaanV/madhacks2026`.
2. **Workspace → Create → Git folder** → `https://github.com/FayzaanV/madhacks2026`. Pull, branch, and commit from the workspace.
3. Deploy with the CLI from a laptop or the Git folder: `databricks bundle deploy` (shared `prod` target; see "Deploying (whole team)").

### Accounts and login (any university, passwordless)
- `POST /api/auth/request {email, school_id}`: the email must be at the chosen school's domain (subdomains OK, e.g. `cs.wisc.edu`); `school_id: "other"` accepts any `.edu` and maps it to a listed school if the domain matches (`schoolForEmail` in `app/src/core/universities.ts`, with tests). Rate limits: 3 links per email per 15 min, 10 per IP per hour (SHA-256 of the proxy-appended last `x-forwarded-for` hop; raw IPs never stored), 300 per hour overall. Only the **SHA-256** of a random token is stored, in Lakebase `login_tokens` (15 min, single use). The link `/login/verify?token=…` is emailed via **Resend**. On verify the school is re-derived from the verified email and inserted into `schools` if new.
- **Demo mode is opt-in.** Showing the link on screen lets anyone sign in as anyone, so it only happens when there's no `RESEND_API_KEY` **and** `DEMO_LOGIN=1` is set (or you're running `next dev` locally). A production server with neither returns 503 "Email sign-in isn't set up". Never set `DEMO_LOGIN=1` on a public deployment; on the Databricks App it's tolerable only because Databricks sign-in already limits access to workspace members.
- `/login/verify` needs a click (POST to `/api/auth/verify`) so email link scanners can't use up the token. Verifying creates the user if new (100 Clout) and a session: random id in an `httpOnly`, `Secure`, `SameSite=Lax` cookie `curve_session`; only its SHA-256 is stored in `sessions` (30 days).
- **Usernames:** new accounts get a random placeholder (`brave_wolf6383`), never derived from the email, so school IDs aren't exposed. After the first sign-in the app sends you to `/welcome` to pick one; change it later on `/me`. Rules: 3–20 chars `[a-z0-9_]`, case-insensitively unique across everyone (simulated users included), reserved names blocked (`setHandle` in `app/src/server/auth.ts`, `PATCH /api/me`).
- No passwords anywhere. Sign-in links only point at `APP_ORIGIN`, localhost, or `yomi-*.databricksapps.com` (forged Host headers are rejected).
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
| PATCH | `/api/me` | ✓ | `{handle?, title?}` → change username (409 if taken) and/or displayed title (must be earned; `null` = automatic) |
| GET | `/api/me/portfolio?page=` | ✓ | summary, positions (open + settled), trade history (50/page), Clout history |
| PUT / DELETE | `/api/me/avatar` | ✓ | raw image body (webp/png/jpeg, ≤ 64 KB; the UI resizes to 128px) / remove |
| GET | `/api/users/:id/avatar` | – | profile picture (cache forever; URLs carry `?v=`) |
| DELETE | `/api/me` | ✓ | delete account (anonymized, trades kept) |
| GET | `/api/markets?q=&status=` | – | markets with live prices |
| POST | `/api/markets` | ✓ admin | `{question, course, market_type: "binary"\|"multiple_choice", outcomes?, closes_at, resolution_source?, liquidity_b?, not_about_a_student: true}` → `{marketId}` |
| POST | `/api/venues/:id/reports` | ✓ | `{metric: "wait_min"\|"line_len", value}` → student check-in (1 per venue per 15 min) |
| POST | `/api/partner/metrics` | Bearer partner key | `[{venue_id, metric, value, observed_at}]` (≤ 1000) → `{accepted, duplicates}` |
| GET | `/api/partner/forecasts` | Bearer partner key | crowd chance of Yes for your venues' Union markets, last 7 days |
| POST / DELETE | `/api/partners` / `/api/partners/:id` | ✓ admin | create a partner key `{name, venue_ids}` (returned once) / revoke |
| GET | `/api/markets/:id` | – | market, Smart Money, AI insight |
| POST | `/api/markets/:id/trade` | ✓ | buy `{outcome, amount}` (whole Clout) · sell `{side:"sell", outcome, clout}` (whole Clout to receive) or `{side:"sell", outcome, all:true}`; 400 after `closes_at` |
| GET / POST | `/api/markets/:id/comments?before=` | – / ✓ | `{comments, next, total}`, 50 per page newest first / add |
| DELETE | `/api/comments/:id` | ✓ | delete your own comment |
| POST | `/api/markets/:id/ask` | ✓ | AI analyst (streamed text), 10/hour |
| GET | `/api/sports/games`, `/api/sports/games/:id` | – | Big Ten games, live scores |
| POST | `/api/sports/sync` | ✓ admin | run one sports/intramural poller pass now |
| POST | `/api/intramurals/games/:id/report` · `/confirm` · `/dispute` | ✓ captain | intramural result flow |
| POST | `/api/intramurals/leagues`, `/leagues/:id/import`, `/teams/:id/captain`, `/games/:id/result` | ✓ admin | intramural setup and decisions |
| POST | `/api/markets/:id/resolve` | ✓ 500+ | `{outcome \| "void", rationale}` → pays out, starts refresh |
Errors are `{ "error": "…" }` with 400/401/403/404/429. Route handlers are thin wrappers over `app/src/server/*`.

### Deploying (whole team)
There is **one shared deployment** (bundle target `prod`, the default), at `/Workspace/Shared/.bundle/the_curve/prod`. The `users` group (everyone in the workspace) has CAN_MANAGE on its jobs, pipeline and the `yomi` app, plus CAN_MANAGE on the Lakebase project `the-curve-ledger`, so **any teammate can deploy**:
1. `git pull` on `main` (never deploy a stale or unmerged branch: the last deploy wins for everyone).
2. Once: `databricks auth login --host https://dbc-9eafb64f-74c3.cloud.databricks.com` (profile `DEFAULT`).
3. `databricks bundle deploy` → updates jobs/pipeline/app config. If app code changed: `databricks bundle run yomi`.
4. If `db/schema.sql` changed, apply the new statements to Lakebase (`node app/scripts/ledger-sql.mjs "<sql>"`) **before** deploying code that uses them. They're written to be idempotent.
- Jobs run as whoever deployed last. `yomi-refresh` runs every 15 minutes.
- Don't use `-t dev` for the app or pipeline: dev makes personal copies that collide with the shared `yomi` app name and the pipeline's tables.

### Running things
```
python3 scripts/dbsql.py "SELECT * FROM the_curve.gold.leaderboard LIMIT 5"   # SQL on the warehouse
node app/scripts/ledger-sql.mjs "SELECT count(*) FROM trades"                # SQL on Lakebase
node app/scripts/ledger-sql.mjs "$(cat db/schema.sql)"                      # apply schema changes (idempotent, keeps data)
databricks bundle run simulate_and_build   # rebuild sim data — TRUNCATES the ledger (all accounts + bets). Team agreement only.
databricks bundle run refresh              # sync + pipeline + AI insights (also runs every 15 min)
databricks bundle run yomi                 # rebuild + restart the website
cd app && npm run dev                                                        # local app (uses your CLI login)
```
After the app is (re)created, grant its service principal access: `node app/scripts/ledger-sql.mjs grant-app <client-id>` and `GRANT USE CATALOG, USE SCHEMA, SELECT ON CATALOG the_curve TO \`<client-id>\`` (client id from `databricks apps get yomi`).

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
| `bronze` | `venues_raw`, `venue_metrics_raw`, `venue_reports_raw`, `market_rules_raw`, `schools_raw`, `sessions_raw`, `users_raw`, `markets_raw`, `outcomes_raw`, `trades_raw`, `resolutions_raw`, `disputes_raw`, `comments_raw`, `ai_questions_raw` |
| `silver` | `venues`, `venue_metrics` (with Madison `local_ts`), `market_rules`, `schools`, `users`, `markets`, `outcomes` (with crowd price), `trades_enriched` (trade + market + user + post-trade price), `resolutions` |
| `gold` | `school_rankings`, `user_clout`, `user_calibration` (bucketed curve; `user_id='__all__'` = campus), `user_clout_history` (true Clout after each sell/resolution, for the portfolio chart), `user_market_brier`, `user_brier`, `user_course_clout`, `clout_drift` (ledger vs gold balance; should be empty), `leaderboard` (scope: overall/course/major/dorm/club, incl. `rank_from_bottom`), `market_smart_money`, `market_mispricing`, `market_price_history`, `user_flair`, `market_ai_insights`, `venue_baselines`, `union_forecasts`, `union_market_scores`, `union_accuracy` |
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
`ADMIN_EMAILS` (comma-separated Yomi sign-in emails) lets those accounts create markets and resolve without 500 Clout. On the app it comes from the secret `the-curve/admin_emails` (app resource `admin-emails`); update it with `databricks secrets put-secret the-curve admin_emails --string-value "a@wisc.edu,b@wisc.edu"` then `databricks bundle run yomi`. Locally put it in `app/.env.local`. **Never in the repo** (it's public). `REFRESH_JOB_ID` comes from the app's `refresh-job` resource; locally the job is found by name.

Gold reads (`querySql`) are cached for 30 s per query and cleared on resolution.

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
- `STARTING_CLOUT = 100`. `canAfford(balance, amount)` = `0 < amount <= balance`. Trades are whole Clout: `placeBuy` needs an integer `amount >= 1`; `placeSell` needs an integer `clout >= 1` (shares = `sharesForProceeds(q,i,a) = −b·ln(1 − (S/E_i)(1 − e^(−a/b)))`, the inverse of `sellProceeds`) or `"all"`. A bet deducts `amount` from `users.clout` in the same Lakebase transaction that records the trade (`app/src/server/markets.ts` `placeBuy`).
- **Selling (signed trades).** `placeSell` sells `k` shares back at the LMSR price: `sellProceeds(q,i,k) = C(q) − C(q − k·e_i)` (`applySell` in `lmsr.ts`/`clout.py`). Trades are signed: a sell has `shares = −k`, `clout_spent = −proceeds`, and `basis_change = −sellBasis(basis, position, k)` (average cost). Position = `Σ shares`; open stake (cost basis still held) = `Σ basis_change` (`openStakeSql` in `ledger.ts`, used everywhere); realized on a sell = proceeds − average cost removed. Can't sell more than you hold.
- Trades lock the market row `FOR SHARE`, then the user, then the outcomes; `resolveMarket` takes the market `FOR UPDATE`, so no trade lands mid-resolution.
- Gold: `user_clout.clout = 100 + realized_profit`, `available = clout - open_stake`. realized = resolved markets `Σ(won·shares − clout_spent)` + open markets `Σ(basis_change − clout_spent)` (profit taken by selling); voided markets count nothing.

### Payout
- Each winning share **still held** pays **1 Clout**; losing shares pay 0. With signed trades the payout is `Σ shares` on the winner.
- Net Clout change for a market = `Σ winning shares − Σ clout_spent` (sells are negative, so proceeds count).
- Voided market: each trader's net `Σ clout_spent` is credited back, which takes back profit taken by selling. (Creator penalty not built yet.)

### Brier score and calibration
- Per forecast: `(f − o)²`, `f` = forecast probability, `o ∈ {0,1}`. User Brier: per resolved market, the stake-weighted mean of its trades' `(f − o)²`; then the plain mean over markets, so every market counts once (lower is better). `n_forecasts` = markets. Calibration is still per trade.
- A trade's forecast `f` = **post-trade price** of the outcome the user bought. Only buys are forecasts; Brier and calibration ignore sells. Smart Money weights each profitable user's cost basis still held per outcome (`GREATEST(Σ basis_change, 0)`).
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
