-- Tracks the last time a user explicitly triggered the job-matching pipeline,
-- used to rate-limit repeated/accidental triggers of /api/pipeline/search-match.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_search_triggered_at TIMESTAMP WITH TIME ZONE;
