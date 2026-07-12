-- Enable the pgvector extension to work with embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE, -- References auth.users(id)
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    target_roles TEXT[] DEFAULT '{}',
    preferred_country TEXT DEFAULT 'us',
    min_match_score INTEGER DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. RESUMES Table
CREATE TABLE IF NOT EXISTS public.resumes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users(id)
    raw_file_url TEXT NOT NULL,
    parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(768), -- sized exactly for text-embedding-004 / gemini-embedding-2-preview (768 dimensions)
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. JOB SOURCES Table
CREATE TABLE IF NOT EXISTS public.job_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'adzuna', 'jsearch', 'remotive', etc.
    config JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true
);

-- 4. JOBS Table
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id TEXT NOT NULL, -- e.g., 'adzuna' or 'jsearch'
    external_job_id TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    country TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(768), -- matches resume embedding dimension (768)
    apply_url TEXT NOT NULL,
    posted_date TIMESTAMP WITH TIME ZONE,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(source_id, external_job_id)
);

-- Create an index on job embeddings for cosine similarity search
CREATE INDEX IF NOT EXISTS jobs_embedding_cosine_idx ON public.jobs USING hnsw (embedding vector_cosine_ops);

-- 5. JOB MATCHES Table
CREATE TABLE IF NOT EXISTS public.job_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users(id)
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    resume_version INTEGER NOT NULL,
    similarity_score NUMERIC NOT NULL,
    llm_score NUMERIC,
    score_breakdown JSONB DEFAULT '{}'::jsonb,
    gap_analysis JSONB DEFAULT '[]'::jsonb,
    resume_suggestions JSONB DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('new','viewed','saved','applied','dismissed')) DEFAULT 'new',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, job_id)
);

-- 6. APPLICATION HISTORY Table
CREATE TABLE IF NOT EXISTS public.application_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users(id)
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes TEXT,
    follow_up_date TIMESTAMP WITH TIME ZONE,
    outcome TEXT NOT NULL CHECK (outcome IN ('pending','interview','rejected','offer')) DEFAULT 'pending'
);

-- ==========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_history ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
CREATE POLICY "Users can view their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Resumes Policies
CREATE POLICY "Users can view their own resumes"
    ON public.resumes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own resumes"
    ON public.resumes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own resumes"
    ON public.resumes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. Job Sources Policies (Shared, Read-only for authenticated users, Admin/Service-role only for write)
CREATE POLICY "Authenticated users can read job sources"
    ON public.job_sources FOR SELECT
    TO authenticated
    USING (true);

-- 4. Jobs Policies (Shared, Read-only for authenticated users, service-role can do everything)
CREATE POLICY "Authenticated users can read jobs"
    ON public.jobs FOR SELECT
    TO authenticated
    USING (true);

-- 5. Job Matches Policies
CREATE POLICY "Users can view their own job matches"
    ON public.job_matches FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own job matches"
    ON public.job_matches FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own job matches"
    ON public.job_matches FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own job matches"
    ON public.job_matches FOR DELETE
    USING (auth.uid() = user_id);

-- 6. Application History Policies
CREATE POLICY "Users can view their own application history"
    ON public.application_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own application history"
    ON public.application_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own application history"
    ON public.application_history FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own application history"
    ON public.application_history FOR DELETE
    USING (auth.uid() = user_id);

-- ==========================================
-- STORED PROCEDURE FOR COSINE SIMILARITY SEARCH
-- ==========================================

-- A custom function that takes a query embedding and a similarity threshold,
-- and returns a list of matching jobs that have not been scored yet or overall top similarity
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
    WHERE (jobs.country = target_country OR target_country = 'all' OR target_country IS NULL)
      AND jobs.embedding IS NOT NULL
      AND 1 - (jobs.embedding <=> query_embedding) > similarity_threshold
    ORDER BY jobs.embedding <=> query_embedding
    LIMIT match_limit;
END;
$$;
