# JobRadar — session notes / handoff doc

This file exists so a future session (mine or otherwise) can pick up exactly
where this one left off. If context runs out, point me at this file plus
whichever specific source files are relevant to the next task.

## Architecture (quick reference)

- **Frontend**: React 19 + Vite, single-page (`src/App.tsx`, state/actions in
  `src/context/AppContext.tsx`).
- **Backend**: Express app in `server.ts`, deployed as one Vercel serverless
  function (`api/index.ts` re-exports the same `app`). Runs standalone via
  `tsx server.ts` locally.
- **Data**: Supabase/Postgres + pgvector (`supabase/migrations/*.sql`). Falls
  back to an in-memory `localDB` (in `src/lib/db.ts`) when Supabase isn't
  configured — this is "demo mode," used for local dev without credentials.
- **AI**: Google Gemini — resume parsing, match scoring, embeddings
  (`src/lib/ai.ts`, `src/lib/embeddings.ts`). A free deterministic parser
  (`src/lib/deterministic_parser.ts`) handles most resume/job-requirement
  extraction without Gemini, to conserve the very limited free-tier quota.
- **Job ingestion**: `src/lib/job_sources.ts` — Adzuna, JSearch (RapidAPI),
  Remotive, Arbeitnow adapters, aggregated by `JobSourcesManager`.
- **Pipeline**: `runJobMatchingPipelineForUser` in `server.ts` — fetch jobs →
  dedupe/ingest → backfill embeddings+requirements → vector-similarity
  shortlist (pgvector) → Gemini scores each shortlisted job → cache in
  `job_matches`. Triggered ONLY by the explicit "Search For New Jobs" button
  (`POST /api/pipeline/search-match`) — never by resume save or country change.

## Environment / deployment facts

- Deployed on **Vercel**, connected to GitHub, auto-deploys from `main`.
- **I (Claude) cannot `git push`** in this sandbox — no credentials. I can
  commit locally; the user has to push themselves each time.
- Supabase migrations are **not** auto-applied on deploy — must be run
  manually via the Supabase SQL editor. Current migrations:
  - `01_initial_schema.sql` — base schema, RLS policies, `match_jobs` fn v1
  - `02_add_last_search_triggered_at.sql` — rate-limit column on `profiles`
  - `03_include_remote_jobs_in_match.sql` — fixes `match_jobs` to always
    include remote-tagged jobs (see issue #12 below)
- Vercel **build logs** ≠ **runtime logs**. Runtime logs (where our
  `console.log`/`console.error` calls show up) are in a separate "Logs" /
  "Runtime Logs" view and only populate while a request is being handled —
  open that view, then trigger the action in the app.
- **Gemini free tier is the biggest ongoing constraint**: `gemini-3.5-flash`
  is capped at **20 requests/day**. With the current per-run scoring cap of
  8 jobs, that's roughly 2 full "Search For New Jobs" runs per day before
  hitting `RESOURCE_EXHAUSTED` for the rest of the day. No code fix changes
  this — it requires a Gemini billing/plan upgrade if more volume is needed.
- User's test account email: `hemanth8892@gmail.com`.

## Issues found and fixed, in order

1. **Broken access control (IDOR)** — every user-scoped API route trusted a
   client-supplied `userId` with zero verification.
   → New `src/lib/auth.ts`: `resolveUserId()` verifies the Supabase JWT when
   Supabase is configured (401/403 on mismatch/missing token); demo mode
   still trusts the client (no real backend auth exists there, low risk,
   in-memory only). Applied via `asyncHandler` wrapper across all
   user-scoped routes in `server.ts`. Frontend `AppContext.tsx` now reuses
   one Supabase client, tracks the session, and `apiFetch()` attaches the
   Bearer token.

2. **Silent DB fallback to in-memory on ANY Supabase error** — `db.ts`
   caught every Supabase error (even real ones) and silently wrote to
   `localDB` instead, which doesn't even persist across Vercel serverless
   invocations — looked like success, silently lost data.
   → `db.ts`: branch explicitly on `isSupabaseConfigured()` *before*
   attempting anything. Local fallback only used when Supabase isn't
   configured at all; real Supabase errors now throw and surface as real
   500s. Also fixed `upsertJobs` to do one bulk upsert instead of N
   sequential calls.

3–4. **`pdf-parse` broke everything, twice.** v2.4.5's API didn't match the
   original code (fixed locally) — but its `pdfjs-dist` dependency
   references the browser global `DOMMatrix` at *module load time* and
   needs `@napi-rs/canvas` (native binary, unavailable on Vercel) to
   polyfill it. That crashed the **entire serverless function** on cold
   start (`FUNCTION_INVOCATION_FAILED` for every route, not just resume
   upload).
   → Swapped to **`unpdf`** (serverless-safe, no required native deps).
   Import is lazy/dynamic inside the route handler (not top-level), so any
   future dependency failure only breaks that one route.

5. **Login/signup silently failing to create profile rows** — when Supabase
   requires email confirmation, `signUp()` returns a user but no session;
   the follow-up `/api/profile` POST went out with no auth header, got a
   401 from the new auth guard, and the code never checked `res.ok` — so it
   failed silently while showing a false "success" UI state.
   → `AppContext.tsx`: check `res.ok`, throw with the server's error
   message; if `signUp()` returns no session, throw a clear "check your
   email to confirm" message instead of proceeding as authenticated.

6. **Embedding dimension mismatch** — Gemini embedding models default to
   3072 dims; Supabase schema is `vector(768)` (required — pgvector's HNSW
   index caps at 2000 dims). Every embedding write failed.
   → `src/lib/embeddings.ts`: added `config: { outputDimensionality: 768 }`.

7. **No resilience to transient Gemini errors** (503 "model overloaded").
   → `src/lib/ai.ts`: `withGeminiRetry()` — retries 429/503 with
   exponential backoff, applied to all Gemini calls.

8. **Heavy, avoidable Gemini dependency for resume/job parsing.**
   → New `src/lib/deterministic_parser.ts`: regex + curated skill/tool/title
   dictionary parser (skills, tools, titles, years-of-experience via
   date-range math, education, job seniority, required_skills, must_haves
   via bullet-section extraction). Used first; Gemini only as fallback when
   not confident (later: **removed entirely** for job requirements — see
   #16).

9. **Resume save was coupled to an immediate, synchronous, full pipeline
   run** — every save (and every country change) triggered the expensive
   Gemini-heavy pipeline inline.
   → `server.ts`: `/api/resume/confirm` and `/api/resume/update` now ONLY
   save (no embedding gen, no pipeline call) — `/api/pipeline/search-match`
   already lazily generates the embedding on demand and is now the *sole*
   trigger. `AppContext.tsx`'s `updateCountry()` no longer auto-triggers
   search. UI copy updated (`ParsedReviewModal.tsx`, `App.tsx`).

10. **Hardcoded `"us"` default location.**
    → New `src/lib/geolocation.ts`: `detectPreferredCountry()` — browser
    Geolocation API → BigDataCloud free reverse-geocode API → falls back to
    `"in"` on any denial/failure/timeout. Wired into `login()`/`signup()`
    (only for genuinely new profiles — never overwrites an existing user's
    saved preference). All other hardcoded `"us"` fallbacks → `"in"`.

11. **Pipeline hardening (original review backlog)**: serial Gemini calls in
    the backfill/scoring loops, no runtime cap, no rate limiting.
    → `server.ts`: `mapWithConcurrency()` helper (concurrency=4) on both
    loops; fresh scoring capped at 8 jobs/run (rest deferred to next
    run/cron); `vercel.json` sets `maxDuration: 60`; new migration `02` +
    `DbService.touchProfileLastSearch()` + 30s per-user cooldown on
    `/api/pipeline/search-match` (bypassed for trusted cron calls).

12. **Remote jobs (`country: 'all'`) were structurally unreachable** —
    `match_jobs` (SQL) and its local-mode JS equivalent only included
    `'all'`-tagged jobs when the *search target itself* was `'all'`, but the
    country dropdown (`COUNTRIES` in `src/types.ts`) has no such option —
    remote jobs could never surface through the UI, for any country.
    → New migration `03_include_remote_jobs_in_match.sql` + matching fix in
    `db.ts`: remote jobs always included regardless of selected country.

13. **Search only used up to 2 resume titles, never skills**, for job-board
    keyword queries — could miss jobs a skill-based search would catch.
    → `server.ts`: search queries now include up to 2 titles + up to 2 top
    skills, deduplicated.

14. **Added Arbeitnow** as a job source — free, keyless, EU/remote-focused.
    → New `ArbeitnowAdapter` in `src/lib/job_sources.ts`, registered in
    `JobSourcesManager`. Verified against the live API.

15. **`upsertProfile` NOT NULL violation on `name`** — subtle Postgres
    behavior: `.upsert()` (`INSERT ... ON CONFLICT DO UPDATE`) validates NOT
    NULL constraints against the *full candidate INSERT row* before it even
    checks for a conflict — so a payload missing `name` failed even when the
    profile already existed and the call should've been a harmless partial
    update. `/api/pipeline/search-match`'s `upsertProfile()` call never
    passed `name`.
    → `db.ts`: `upsertProfile` no longer uses `.upsert()` — does an explicit
    `UPDATE` first (only touches provided columns), falls back to `INSERT`
    (with a name default) only when no row exists yet.

16. **Root cause of "matches never appear": Gemini's 20-requests/day free
    quota was exhausted by job-requirements extraction before Stage 2
    scoring (the part that actually produces `job_matches`) got a turn.**
    Retrying a *daily* quota exhaustion within seconds is futile and was
    dragging requests into Vercel's 60s timeout.
    → `server.ts`: job requirements backfill **never** calls Gemini anymore
    (always uses the deterministic parser, confident or not — this data
    isn't used in matching, so quality loss is irrelevant). `ai.ts`: removed
    the now-dead `extractJobRequirements` function; `withGeminiRetry` now
    detects daily-quota-exhaustion 429s (`"PerDay"` in the error message)
    and fails fast instead of retrying. Also added a 10-result display cap
    on the dashboard (`App.tsx`).

## Evaluated but not implemented

- **Findwork.dev** as an additional job source — plausible, but requires a
  free API key and the exact auth header format needs verifying against a
  real key before writing an adapter (not done).
- **CareerOneStop** — rejected: requires emailing for manual approval, no
  self-serve API key; also purely US-market, redundant with Adzuna.
- **LoopCV** — rejected: it's a job-*application-automation* SaaS product,
  not a job-listings API; its "free tier" is explicitly capped for
  evaluation only.

## Key files map

| File | Purpose |
|---|---|
| `server.ts` | Express app, all API routes, central job-matching pipeline |
| `src/lib/auth.ts` | JWT verification / `resolveUserId` |
| `src/lib/db.ts` | `DbService` — Supabase + in-memory dual-mode data layer |
| `src/lib/ai.ts` | Gemini client, resume parsing, match scoring, retry helper |
| `src/lib/embeddings.ts` | Gemini embedding generation |
| `src/lib/deterministic_parser.ts` | Free regex/dictionary resume & job parsing |
| `src/lib/job_sources.ts` | Adzuna/JSearch/Remotive/Arbeitnow adapters |
| `src/lib/geolocation.ts` | Browser geolocation → country code |
| `src/context/AppContext.tsx` | Frontend state/actions, `apiFetch` with auth |
| `src/App.tsx` | Main dashboard UI |
| `src/components/ParsedReviewModal.tsx` | Resume review/confirm UI |
| `src/types.ts` | Shared types, `COUNTRIES` list |
| `supabase/migrations/*.sql` | 01 schema, 02 rate-limit column, 03 remote-jobs fix |
| `vercel.json` | `maxDuration` config |

## Open items / next steps

- Confirm the Gemini-quota fix actually produces visible matches on a fresh
  daily quota (in progress as of the last message in this session).
- Decide whether to add Findwork.dev as a second job source.
- Decide whether to raise the Gemini quota/plan if 20/day remains limiting.
