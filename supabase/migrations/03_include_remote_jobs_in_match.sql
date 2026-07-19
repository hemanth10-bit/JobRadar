-- Remote jobs are ingested with country = 'all' (see Remotive/JSearch/Adzuna
-- adapters in src/lib/job_sources.ts). The original match_jobs only included
-- them when target_country itself was 'all' — but the app's country dropdown
-- never offers an 'all' option, so remote jobs were structurally unreachable
-- through the UI. Remote jobs should always be included alongside
-- country-specific ones, regardless of which country is selected.
CREATE OR REPLACE FUNCTION match_jobs(
    query_embedding vector(768),
    similarity_threshold double precision,
    match_limit integer,
    target_country text
)
RETURNS TABLE (
    id UUID,
    source_id TEXT,
    external_job_id TEXT,
    title TEXT,
    company TEXT,
    location TEXT,
    country TEXT,
    description TEXT,
    requirements_json JSONB,
    apply_url TEXT,
    posted_date TIMESTAMP WITH TIME ZONE,
    similarity double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        jobs.id,
        jobs.source_id,
        jobs.external_job_id,
        jobs.title,
        jobs.company,
        jobs.location,
        jobs.country,
        jobs.description,
        jobs.requirements_json,
        jobs.apply_url,
        jobs.posted_date,
        1 - (jobs.embedding <=> query_embedding) AS similarity
    FROM jobs
    WHERE (
        jobs.country = target_country
        OR jobs.country = 'all'
        OR target_country = 'all'
        OR target_country IS NULL
      )
      AND jobs.embedding IS NOT NULL
      AND 1 - (jobs.embedding <=> query_embedding) > similarity_threshold
    ORDER BY jobs.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$;
