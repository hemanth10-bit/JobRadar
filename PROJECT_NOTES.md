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
- **AI**: split across two providers (`src/lib/ai.ts`, `src/lib/embeddings.ts`):
  - **Gemini** — embeddings only (`generateEmbedding`). Groq has no embedding
    models, so this stays on Gemini regardless.
  - **Groq** — resume parsing (`parseResumeText`, `llama-3.1-8b-instant`,
    14,400 req/day free) and job-match scoring (`scoreJobMatch`,
    `llama-3.3-70b-versatile`, 1,000 req/day free, falls back to
    `openai/gpt-oss-120b` on daily-quota exhaustion — see issue #24).
    Switched from Gemini because its free tier (as low as 20 requests/day
    for `generateContent`) was the root cause of matches never appearing.
  - A free deterministic parser (`src/lib/deterministic_parser.ts`) handles
    most resume/job-requirement extraction without calling any LLM at all;
    job-requirements extraction *never* calls an LLM anymore (that data isn't
    used in matching, so no quality tradeoff).
- **Job ingestion**: `src/lib/job_sources.ts` — Adzuna, JSearch (direct
  OpenWeb Ninja API, not RapidAPI — see issue #21), Remotive, Arbeitnow
  adapters, aggregated by `JobSourcesManager`. No fake-fallback jobs on
  failure (removed — see issue #20); a source with missing credentials or a
  failed call just contributes zero jobs.
- **Pipeline**: `runJobMatchingPipelineForUser` in `server.ts` — fetch jobs →
  dedupe/ingest → backfill embeddings+requirements → vector-similarity
  shortlist (pgvector) → Groq scores each shortlisted job → cache in
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
- **Gemini's free tier was the biggest constraint, now resolved for the
  scoring/parsing path**: `gemini-3.5-flash` (`generateContent`) is capped
  at as low as **20 requests/day**, which made matches never appear (see
  issue #16). Fixed by moving parsing/scoring to **Groq**
  (`llama-3.1-8b-instant`, 14,400 requests/day free) — see issue #17.
  Gemini is still used for embeddings, but that's a separate quota bucket
  that was never actually the bottleneck (confirmed via logs — embedding
  calls kept succeeding while `generateContent` calls were exhausted).
- **New required env var: `GROQ_API_KEY`.** Get a free key (no credit card)
  at console.groq.com/keys. Must be added to Vercel's environment variables
  (Project Settings → Environment Variables) and the app redeployed — same
  as any other env var here, not auto-provisioned.
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

17. **Follow-up to #16: Groq quota exhausted quickly too, until the deeper
    fix.** Once requirements-extraction stopped burning quota, the *actual*
    remaining constraint was Gemini's 20/day cap on `generateContent` itself
    (used for both parsing and scoring) — 8 scoring calls per run could burn
    through most of a day's budget on its own.
    → Swapped `parseResumeText` and `scoreJobMatch` from Gemini to **Groq**
    (`llama-3.1-8b-instant`, 14,400 req/day free). New `groq-sdk` dependency
    (zero sub-dependencies, no native-binary risk like `pdf-parse` had).
    Uses `response_format: { type: "json_object" }` with the exact schema
    spelled out in the prompt (Groq's free-tier llama models guarantee valid
    JSON syntax but not exact schema match, unlike Gemini's `responseSchema`
    — acceptable since malformed responses are already isolated/skipped
    per-job by existing error handling). New `withGroqRetry` mirrors
    `withGeminiRetry`'s backoff logic. Gemini (`getGeminiClient`,
    `withGeminiRetry`) untouched — still used by `embeddings.ts`. Requires
    `GROQ_API_KEY` (see env notes above). `/api/auth/status` now requires
    both `GEMINI_API_KEY` and `GROQ_API_KEY` to report "configured."

18. **Cosmetic**: browser tab title was still the AI-Studio-scaffold default
    ("My Google AI Studio App") — fixed in `index.html`. Also updated
    now-inaccurate "Scored using Gemini 1.5 & 2.0" / "Powered by Google
    Gemini" UI copy in `App.tsx` to reflect Groq's role.

19. **Resume upload silently mangled DOCX/TXT** — advertised as supported but
    never actually parsed correctly (binary `.docx` read as raw UTF-8 text).
    → `src/App.tsx`: `processUploadedFile` only accepts `application/pdf`,
    rejects everything else client-side. `server.ts`'s `/api/resume/parse`
    now enforces the same check server-side (MIME type or `.pdf` extension)
    before ever touching the parser — restricts uploads to PDF only, front
    and back end.

20. **Every job-source adapter faked results on failure** — Adzuna, JSearch,
    Remotive, and Arbeitnow each fell back to hardcoded sample job postings
    (`SAMPLE_JOBS_BY_COUNTRY` in `job_sources.ts`) whenever their API call
    failed or credentials were missing, with dead `https://example.com/...`
    apply links. These looked like real, clickable jobs in the UI.
    → `src/lib/job_sources.ts`: removed `SAMPLE_JOBS_BY_COUNTRY` and
    `getFallbackJobs()` entirely. Every adapter now returns `[]` on missing
    credentials or a failed fetch — a broken/unconfigured source just
    contributes zero jobs instead of fake ones.

21. **JSearch adapter was calling the wrong API for the user's key** — the
    adapter hit `jsearch.p.rapidapi.com` with `x-rapidapi-*` headers, but the
    user has a key issued directly by **OpenWeb Ninja** (openwebninja.com),
    not a RapidAPI-issued key — these are separate credential systems even
    though OpenWeb Ninja is JSearch's publisher on RapidAPI too. Result: a
    404 on every call (confirmed via Vercel logs).
    → `src/lib/job_sources.ts`: `JSearchAdapter` now calls
    `https://api.openwebninja.com/jsearch/search-v2` directly with an
    `x-api-key` header, reading a new `OPENWEBNINJA_API_KEY` env var (old
    `RAPIDAPI_KEY` removed everywhere, including `.env.example`). **Two
    details are unconfirmed** (public docs were not fully reachable during
    research): whether `page`/`num_pages`-style pagination still works on
    `/search-v2` vs. being cursor-based, and the exact posted-date field name
    (code defensively tries `job_posted_at_datetime_utc` then `job_posted_at`
    then falls back to "now"). Watch Vercel logs after deploy to confirm
    pagination behaves as expected across multiple pages/searches.

22. **Google OAuth `Error 400: redirect_uri_mismatch`** — not a code bug;
    Google Cloud Console's OAuth client didn't have Supabase's callback URL
    (`https://oydohmdulwcbivxabhrg.supabase.co/auth/v1/callback`) registered
    under Authorized redirect URIs. Fixed entirely in Google Cloud Console
    (Credentials → OAuth 2.0 Client → Authorized redirect URIs) — no repo
    changes. Noting here in case it recurs after rotating OAuth credentials.

23. **Added Jooble** as a 5th job source — free key, 69-country coverage, no
    documented rate cap on the free tier, filling the gap left by JSearch's
    tight 200 req/month limit.
    → New `JoobleAdapter` in `src/lib/job_sources.ts` (`POST
    jooble.org/api/{key}` with `keywords`/`location`/`page` JSON body).
    Jooble's `location` param is free-text, not an ISO code, so a small
    `JOOBLE_COUNTRY_NAMES` map translates the app's country codes. Registered
    in `JobSourcesManager`. Requires new `JOOBLE_API_KEY` env var (key is
    auto-issued via a signup form at jooble.org/api/about, no manual
    approval wait — unlike the CareerOneStop friction that got it rejected).
    Not yet live-tested against a real key.

24. **Match/gap/suggestion quality feedback** — user feedback after the app
    was fully working: matches, gap_analysis, and resume_suggestions felt
    generic rather than sharply tailored.
    → `src/lib/ai.ts`:
    - Rewrote `scoreJobMatch`'s system prompt with explicit 0-10 rubric
      anchors per dimension (0-2 none, 3-5 partial, 6-8 solid, 9-10
      near-perfect), a requirement that the model first identify the job's
      actual stated requirements before comparing, and a hard rule that
      every `gap_analysis`/`resume_suggestions` item must cite a specific
      skill/tool/requirement from the job description — generic filler like
      "could improve technical skills" is explicitly banned. `match_score`
      is now explicitly a holistic weighted judgment (skills/responsibilities
      weighted above raw experience), not a mechanical average.
    - Tightened `parseResumeText`'s prompt to forbid inferring unstated
      skills and to compute `years_experience` from actual date-range math
      rather than guessing from title seniority.
    - `scoreJobMatch` moved from `llama-3.1-8b-instant` to
      **`llama-3.3-70b-versatile`** for better nuanced judgment (free tier:
      1,000 req/day, 100K tokens/day — comfortable given the existing
      8-jobs/run scoring cap). `parseResumeText` stays on the 8b model
      (higher volume, more mechanical task, doesn't need the upgrade).
    - Added **`openai/gpt-oss-120b`** (also free on Groq, same 1,000 req/day
      but 200K tokens/day) as a same-key fallback for scoring only: if
      `llama-3.3-70b-versatile` hits its own daily quota (429 with "per day"
      in the message), `scoreJobMatch` transparently retries the same
      request on `gpt-oss-120b` instead of failing that job's scoring for
      the rest of the day — roughly doubles effective daily scoring
      headroom since the two models have independent quota buckets.
      `withGroqRetry` also now fails fast (no wasted retry attempts) on a
      daily-quota 429, mirroring the existing Gemini logic. Shared prompt
      logic extracted into `buildScoringMessages()` so both models get
      identical instructions. **Not yet observed against real traffic** —
      worth checking Vercel logs after a few real search runs to see if
      gap/suggestion text actually reads more specific, and whether the
      gpt-oss-120b fallback path ever triggers.

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
| `src/lib/ai.ts` | Gemini client (embeddings only) + Groq client (resume parsing on 8b, match scoring on 70b w/ gpt-oss-120b fallback) + both retry helpers |
| `src/lib/embeddings.ts` | Gemini embedding generation |
| `src/lib/deterministic_parser.ts` | Free regex/dictionary resume & job parsing |
| `src/lib/job_sources.ts` | Adzuna/JSearch (OpenWeb Ninja direct)/Remotive/Arbeitnow/Jooble adapters |
| `src/lib/geolocation.ts` | Browser geolocation → country code |
| `src/context/AppContext.tsx` | Frontend state/actions, `apiFetch` with auth |
| `src/App.tsx` | Main dashboard UI |
| `src/components/ParsedReviewModal.tsx` | Resume review/confirm UI |
| `src/types.ts` | Shared types, `COUNTRIES` list |
| `supabase/migrations/*.sql` | 01 schema, 02 rate-limit column, 03 remote-jobs fix |
| `vercel.json` | `maxDuration` config |

## Open items / next steps

- **Confirmed working end-to-end** (per user, all prior issues resolved):
  Groq-based parsing/scoring is live and producing matches.
- **New scoring prompt + model changes (issue #24) not yet observed against
  real traffic** — after a few more real "Search For New Jobs" runs, check
  whether gap_analysis/resume_suggestions read as more specific/job-grounded,
  and check Vercel logs for whether the `gpt-oss-120b` fallback path is ever
  triggered (would only show up once `llama-3.3-70b-versatile`'s 1,000
  req/day is exhausted).
- Decide whether to add Findwork.dev as a second job source.
- If Groq's 14,400/day ever becomes limiting (unlikely at current scale, ~10
  users), consider its paid tier or a second provider for overflow.
- **JSearch/OpenWeb Ninja needs a live smoke test**: add `OPENWEBNINJA_API_KEY`
  to Vercel, redeploy, and check logs for whether `/search-v2` pagination
  (`page` param) actually returns different results per page, and which
  posted-date field name the response actually uses (see issue #21).
- **Jooble needs a live smoke test**: sign up at jooble.org/api/about, add
  `JOOBLE_API_KEY` to Vercel, redeploy, and confirm real results come back
  (response field names/shape assumed from general knowledge, not verified
  against a live key — see issue #23).
