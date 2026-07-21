import { IngestedJobInput } from "../types.js";

export interface JobSourceAdapter {
  name: string;
  enabled: boolean;
  fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]>;
}

// ==========================================
// 1. ADZUNA ADAPTER (Requires app_id and app_key)
// ==========================================
export class AdzunaAdapter implements JobSourceAdapter {
  name = "adzuna";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      console.warn("Adzuna API credentials missing. Skipping this source.");
      return [];
    }

    const c = country.toLowerCase() === 'all' ? 'us' : country.toLowerCase();
    const url = `https://api.adzuna.com/v1/api/jobs/${c}/search/${page}?app_id=${appId}&app_key=${appKey}&what=${encodeURIComponent(query)}&content-type=application/json`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Adzuna API error: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.results) return [];

      return data.results.map((job: any) => ({
        external_job_id: job.id.toString(),
        source_id: this.name,
        title: job.title || "Job Title",
        company: job.company?.display_name || "Confidential Company",
        location: job.location?.display_name || "N/A",
        country: c,
        description: job.description || "",
        apply_url: job.redirect_url || "",
        posted_date: job.created || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from Adzuna.", err);
      return [];
    }
  }
}

// ==========================================
// 2. JSEARCH ADAPTER (RapidAPI, Google for Jobs results)
// ==========================================
export class JSearchAdapter implements JobSourceAdapter {
  name = "jsearch";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    const rapidKey = process.env.RAPIDAPI_KEY;

    if (!rapidKey) {
      console.warn("RapidAPI Key missing. Skipping JSearch.");
      return [];
    }

    // Append country keyword to query to scope it naturally
    const cKeyword = country.toUpperCase() !== 'ALL' ? ` in ${country.toUpperCase()}` : "";
    const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query + cKeyword)}&page=${page}&num_pages=1`;

    try {
      const response = await fetch(url, {
        headers: {
          "x-rapidapi-key": rapidKey,
          "x-rapidapi-host": "jsearch.p.rapidapi.com"
        }
      });
      if (!response.ok) {
        throw new Error(`JSearch API error: ${response.statusText}`);
      }
      const resData = await response.json();
      if (!resData.data) return [];

      return resData.data.map((job: any) => ({
        external_job_id: job.job_id,
        source_id: this.name,
        title: job.job_title || "Job Title",
        company: job.employer_name || "Confidential",
        location: [job.job_city, job.job_state].filter(Boolean).join(", ") || job.job_country || "N/A",
        country: country.toLowerCase() === 'all' ? (job.job_country || "us").toLowerCase() : country.toLowerCase(),
        description: job.job_description || "",
        apply_url: job.job_apply_link || "",
        posted_date: job.job_posted_at_datetime_utc || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from JSearch.", err);
      return [];
    }
  }
}

// ==========================================
// 3. REMOTIVE ADAPTER (Free remote jobs, no key)
// ==========================================
export class RemotiveAdapter implements JobSourceAdapter {
  name = "remotive";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    // Remotive is remote first and doesn't support fine country codes. Let's fetch and filter loosely.
    const url = `https://remotive.com/api/remote-jobs?limit=30`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Remotive API error: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.jobs) return [];

      let jobs = data.jobs;

      // Filter by query loosely if provided
      if (query) {
        const q = query.toLowerCase();
        jobs = jobs.filter((j: any) => 
          j.title.toLowerCase().includes(q) || 
          j.description.toLowerCase().includes(q)
        );
      }

      return jobs.map((job: any) => ({
        external_job_id: job.id.toString(),
        source_id: this.name,
        title: job.title,
        company: job.company_name || "Confidential",
        location: job.candidate_required_location || "Remote",
        country: "all", // remote
        description: stripHtml(job.description || ""),
        apply_url: job.url,
        posted_date: job.publication_date || new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from Remotive.", err);
      return [];
    }
  }
}

// Helper function to strip HTML tags from Remotive description
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

// ==========================================
// 4. ARBEITNOW ADAPTER (Free EU/remote jobs, no key)
// ==========================================
// Concentrated on the German-speaking market (Germany, Austria, Switzerland)
// plus remote-friendly roles. No API key, no documented server-side keyword
// search, so — like Remotive — we fetch a page and filter client-side.
export class ArbeitnowAdapter implements JobSourceAdapter {
  name = "arbeitnow";
  enabled = true;

  async fetchJobs(query: string, country: string, page: number): Promise<IngestedJobInput[]> {
    const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Arbeitnow API error: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data.data) return [];

      let jobs = data.data;

      // Filter by query loosely if provided
      if (query) {
        const q = query.toLowerCase();
        jobs = jobs.filter((j: any) =>
          (j.title || "").toLowerCase().includes(q) ||
          (j.description || "").toLowerCase().includes(q) ||
          (j.tags || []).some((tag: string) => tag.toLowerCase().includes(q))
        );
      }

      return jobs.map((job: any) => ({
        external_job_id: job.slug,
        source_id: this.name,
        title: job.title || "Job Title",
        company: job.company_name || "Confidential",
        location: job.location || (job.remote ? "Remote" : "Germany"),
        // Honest about what the data actually says: remote listings are
        // tagged "all" (matches every country search, per the remote-jobs
        // fix); everything else is concentrated on the German market.
        country: job.remote ? "all" : "de",
        description: stripHtml(job.description || ""),
        apply_url: job.url || "",
        posted_date: job.created_at
          ? new Date(job.created_at * 1000).toISOString()
          : new Date().toISOString()
      }));
    } catch (err) {
      console.warn("Failed to fetch from Arbeitnow.", err);
      return [];
    }
  }
}

// ==========================================
// CENTRAL ADAPTER MANAGER
// ==========================================
export class JobSourcesManager {
  private adapters: JobSourceAdapter[] = [];

  constructor() {
    this.adapters = [
      new AdzunaAdapter(),
      new JSearchAdapter(),
      new RemotiveAdapter(),
      new ArbeitnowAdapter()
    ];
  }

  async fetchAll(query: string, country: string): Promise<IngestedJobInput[]> {
    const promises = this.adapters
      .filter(a => a.enabled)
      .map(a => a.fetchJobs(query, country, 1));

    const results = await Promise.allSettled(promises);
    const combined: IngestedJobInput[] = [];

    results.forEach(res => {
      if (res.status === "fulfilled") {
        combined.push(...res.value);
      }
    });

    // Remove duplicates by external_job_id
    const seen = new Set<string>();
    return combined.filter(job => {
      const key = `${job.source_id}:${job.external_job_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
