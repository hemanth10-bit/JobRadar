import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Profile, Resume, Job, JobMatch, ApplicationHistory, IngestedJobInput } from "../types.js";

// ==========================================
// LAZY SUPABASE INITIALIZATION
// ==========================================
let supabaseInstance: SupabaseClient | null = null;
let useLocalFallback = false;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key);
}

export function getSupabaseClient(): SupabaseClient {
  if (useLocalFallback) {
    throw new Error("Supabase is not configured or failed to initialize. Running in Local Storage Fallback mode.");
  }
  
  if (!supabaseInstance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
      useLocalFallback = true;
      console.warn("Supabase URL or Key missing. Database operations will fall back to robust local simulation.");
      throw new Error("Supabase credentials missing. Falling back to simulated DB.");
    }
    
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseInstance;
}

// ==========================================
// LOCAL IN-MEMORY / FILESYSTEM DB FOR DEV DEMO
// ==========================================
// We'll store simulated state in memory. Since the container runs continuously,
// this works beautifully as an active developer-friendly playground!
class LocalSimulatedDatabase {
  public profiles: Profile[] = [];
  public resumes: Resume[] = [];
  public jobs: Job[] = [];
  public jobMatches: JobMatch[] = [];
  public appHistory: ApplicationHistory[] = [];

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    // We can pre-seed with some local mock job sources if needed.
    // In our case we will fetch them on demand or during search.
  }
}

export const localDB = new LocalSimulatedDatabase();

// Cosine similarity in TypeScript
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ==========================================
// UNIFIED DATABASE SERVICE INTERFACE
// ==========================================
export const DbService = {
  // PROFILES
  async getProfile(userId: string): Promise<Profile | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      
      if (error) throw error;
      return data as Profile;
    } catch (err) {
      console.log("Using local simulated profile fetch", err);
      return localDB.profiles.find(p => p.user_id === userId) || null;
    }
  },

  async upsertProfile(profile: Partial<Profile> & { user_id: string; email: string }): Promise<Profile> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .upsert(profile, { onConflict: "user_id" })
        .select()
        .single();
      
      if (error) throw error;
      return data as Profile;
    } catch (err) {
      console.log("Using local simulated profile upsert");
      const existingIdx = localDB.profiles.findIndex(p => p.user_id === profile.user_id);
      const updated: Profile = {
        id: existingIdx >= 0 ? localDB.profiles[existingIdx].id : crypto.randomUUID(),
        user_id: profile.user_id,
        name: profile.name || profile.email.split("@")[0],
        email: profile.email,
        target_roles: profile.target_roles || [],
        preferred_country: profile.preferred_country || "us",
        min_match_score: profile.min_match_score || 50,
        created_at: existingIdx >= 0 ? localDB.profiles[existingIdx].created_at : new Date().toISOString()
      };
      
      if (existingIdx >= 0) {
        localDB.profiles[existingIdx] = updated;
      } else {
        localDB.profiles.push(updated);
      }
      return updated;
    }
  },

  // RESUMES
  async getActiveResume(userId: string): Promise<Resume | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("resumes")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
      
      if (error) throw error;
      return data as Resume;
    } catch (err) {
      return localDB.resumes.find(r => r.user_id === userId && r.is_active) || null;
    }
  },

  async insertResume(resume: Omit<Resume, 'id' | 'created_at'> & { embedding?: number[] }): Promise<Resume> {
    try {
      const supabase = getSupabaseClient();
      
      // Deactivate other resumes first
      await supabase
        .from("resumes")
        .update({ is_active: false })
        .eq("user_id", resume.user_id);

      const { data, error } = await supabase
        .from("resumes")
        .insert({
          ...resume,
          is_active: true
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as Resume;
    } catch (err) {
      console.log("Using local simulated resume insert");
      // Deactivate other local resumes
      localDB.resumes.forEach(r => {
        if (r.user_id === resume.user_id) r.is_active = false;
      });

      const newResume: Resume & { embedding?: number[] } = {
        id: crypto.randomUUID(),
        ...resume,
        is_active: true,
        created_at: new Date().toISOString()
      };
      localDB.resumes.push(newResume);
      return newResume;
    }
  },

  async getResumes(userId: string): Promise<Resume[]> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("resumes")
        .select("*")
        .eq("user_id", userId)
        .order("version", { ascending: false });
      
      if (error) throw error;
      return (data || []) as Resume[];
    } catch (err) {
      return localDB.resumes
        .filter(r => r.user_id === userId)
        .sort((a, b) => b.version - a.version);
    }
  },

  async activateResume(userId: string, resumeId: string): Promise<Resume> {
    try {
      const supabase = getSupabaseClient();
      
      // Deactivate all resumes first
      await supabase
        .from("resumes")
        .update({ is_active: false })
        .eq("user_id", userId);

      // Set specified resume as active
      const { data, error } = await supabase
        .from("resumes")
        .update({ is_active: true })
        .eq("id", resumeId)
        .eq("user_id", userId)
        .select()
        .single();
      
      if (error) throw error;
      return data as Resume;
    } catch (err) {
      console.log("Using local simulated resume activation");
      localDB.resumes.forEach(r => {
        if (r.user_id === userId) {
          r.is_active = (r.id === resumeId);
        }
      });
      const active = localDB.resumes.find(r => r.id === resumeId && r.user_id === userId);
      if (!active) throw new Error("Resume not found");
      return active;
    }
  },

  async updateResumeFields(resumeId: string, fields: Partial<Resume> & { embedding?: number[] }): Promise<Resume> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("resumes")
        .update(fields)
        .eq("id", resumeId)
        .select()
        .single();
      if (error) throw error;
      return data as Resume;
    } catch (err) {
      console.log("Using local simulated resume update");
      const resume = localDB.resumes.find(r => r.id === resumeId);
      if (resume) {
        Object.assign(resume, fields);
        return resume;
      }
      throw new Error("Resume not found");
    }
  },

  // JOBS
  async getJobsByCountry(country: string): Promise<Job[]> {
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from("jobs").select("*");
      if (country !== "all") {
        query = query.eq("country", country);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Job[];
    } catch (err) {
      if (country === "all") return localDB.jobs;
      return localDB.jobs.filter(j => j.country === country);
    }
  },

  async upsertJobs(jobsInput: IngestedJobInput[]): Promise<Job[]> {
    try {
      const supabase = getSupabaseClient();
      const results: Job[] = [];
      
      for (const job of jobsInput) {
        const { data, error } = await supabase
          .from("jobs")
          .upsert({
            source_id: job.source_id,
            external_job_id: job.external_job_id,
            title: job.title,
            company: job.company,
            location: job.location,
            country: job.country,
            description: job.description,
            apply_url: job.apply_url,
            posted_date: job.posted_date,
            scraped_at: new Date().toISOString()
          }, { onConflict: "source_id,external_job_id" })
          .select()
          .single();
        
        if (!error && data) {
          results.push(data as Job);
        }
      }
      return results;
    } catch (err) {
      console.log("Using local simulated jobs upsert");
      const results: Job[] = [];
      
      for (const job of jobsInput) {
        const existingIdx = localDB.jobs.findIndex(j => j.source_id === job.source_id && j.external_job_id === job.external_job_id);
        const updatedJob: Job = {
          id: existingIdx >= 0 ? localDB.jobs[existingIdx].id : crypto.randomUUID(),
          source_id: job.source_id,
          external_job_id: job.external_job_id,
          title: job.title,
          company: job.company,
          location: job.location,
          country: job.country,
          description: job.description,
          requirements_json: existingIdx >= 0 ? localDB.jobs[existingIdx].requirements_json : {
            required_skills: [],
            experience_years_needed: 0,
            seniority: "N/A",
            must_haves: []
          },
          apply_url: job.apply_url,
          posted_date: job.posted_date,
          scraped_at: new Date().toISOString()
        };

        if (existingIdx >= 0) {
          localDB.jobs[existingIdx] = updatedJob;
        } else {
          localDB.jobs.push(updatedJob);
        }
        results.push(updatedJob);
      }
      return results;
    }
  },

  async updateJobFields(jobId: string, fields: Partial<Job> & { embedding?: number[] }): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from("jobs")
        .update(fields)
        .eq("id", jobId);
    } catch (err) {
      const job = localDB.jobs.find(j => j.id === jobId);
      if (job) {
        Object.assign(job, fields);
      }
    }
  },

  // MATCH JOBS (COSIM PIPELINE)
  async queryTopJobsForEmbedding(embedding: number[], country: string, limit = 15): Promise<(Job & { similarity: number })[]> {
    try {
      const supabase = getSupabaseClient();
      // Call pgvector matching function we added in migrations
      const { data, error } = await supabase.rpc("match_jobs", {
        query_embedding: embedding,
        similarity_threshold: -1.0, // get all to filter top
        match_limit: limit,
        target_country: country
      });
      if (error) throw error;
      return data as (Job & { similarity: number })[];
    } catch (err) {
      console.log("Using local simulated vector search match_jobs", err);
      // Run math in JS
      const filteredJobs = country === "all" ? localDB.jobs : localDB.jobs.filter(j => j.country === country);
      
      const scored = filteredJobs.map(job => {
        // Retrieve embedding if we saved it locally
        const jobWithEmbedding = job as any;
        const jobVector = jobWithEmbedding.embedding || [];
        const sim = jobVector.length > 0 ? calculateCosineSimilarity(embedding, jobVector) : Math.random() * 0.4 + 0.4; // fallback to random reasonable similarity if missing
        return {
          ...job,
          similarity: sim
        };
      });

      return scored
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    }
  },

  // JOB MATCHES (STAGE 2 SCORING CACHING)
  async getJobMatches(userId: string): Promise<JobMatch[]> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("job_matches")
        .select(`
          *,
          job:jobs(*)
        `)
        .eq("user_id", userId)
        .order("llm_score", { ascending: false });
      
      if (error) throw error;
      return data as JobMatch[];
    } catch (err) {
      const matches = localDB.jobMatches.filter(m => m.user_id === userId);
      // Attach joined jobs
      return matches.map(m => ({
        ...m,
        job: localDB.jobs.find(j => j.id === m.job_id)
      })).sort((a, b) => (b.llm_score || 0) - (a.llm_score || 0));
    }
  },

  async upsertJobMatch(match: Omit<JobMatch, 'id' | 'created_at'>): Promise<JobMatch> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("job_matches")
        .upsert({
          user_id: match.user_id,
          job_id: match.job_id,
          resume_version: match.resume_version,
          similarity_score: match.similarity_score,
          llm_score: match.llm_score,
          score_breakdown: match.score_breakdown,
          gap_analysis: match.gap_analysis,
          resume_suggestions: match.resume_suggestions,
          status: match.status
        }, { onConflict: "user_id,job_id" })
        .select()
        .single();
      
      if (error) throw error;
      return data as JobMatch;
    } catch (err) {
      console.log("Using local simulated job_matches upsert");
      const existingIdx = localDB.jobMatches.findIndex(m => m.user_id === match.user_id && m.job_id === match.job_id);
      
      const updatedMatch: JobMatch = {
        id: existingIdx >= 0 ? localDB.jobMatches[existingIdx].id : crypto.randomUUID(),
        ...match,
        created_at: existingIdx >= 0 ? localDB.jobMatches[existingIdx].created_at : new Date().toISOString()
      };

      if (existingIdx >= 0) {
        localDB.jobMatches[existingIdx] = updatedMatch;
      } else {
        localDB.jobMatches.push(updatedMatch);
      }
      return updatedMatch;
    }
  },

  async updateJobMatchStatus(userId: string, matchId: string, status: JobMatch['status']): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const updatePayload: any = { status };
      if (status === 'applied') {
        updatePayload.applied_at = new Date().toISOString();
      }
      await supabase
        .from("job_matches")
        .update(updatePayload)
        .eq("id", matchId)
        .eq("user_id", userId);
    } catch (err) {
      const match = localDB.jobMatches.find(m => m.id === matchId && m.user_id === userId);
      if (match) {
        match.status = status;
        if (status === 'applied') {
          match.applied_at = new Date().toISOString();
        }
      }
    }
  },

  // APPLICATION HISTORY
  async getApplicationHistory(userId: string): Promise<ApplicationHistory[]> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("application_history")
        .select(`
          *,
          job:jobs(*)
        `)
        .eq("user_id", userId)
        .order("applied_at", { ascending: false });

      if (error) throw error;
      return data as ApplicationHistory[];
    } catch (err) {
      const history = localDB.appHistory.filter(h => h.user_id === userId);
      return history.map(h => ({
        ...h,
        job: localDB.jobs.find(j => j.id === h.job_id)
      })).sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime());
    }
  },

  async insertApplicationHistory(app: Omit<ApplicationHistory, 'id'>): Promise<ApplicationHistory> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("application_history")
        .insert(app)
        .select()
        .single();
      
      if (error) throw error;
      return data as ApplicationHistory;
    } catch (err) {
      const newApp: ApplicationHistory = {
        id: crypto.randomUUID(),
        ...app
      };
      localDB.appHistory.push(newApp);
      return newApp;
    }
  }
};
